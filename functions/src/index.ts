import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();
const db = getFirestore();
const region = "southamerica-east1";
const eventTypes = ["clock_in", "break_start", "break_end", "clock_out"] as const;
type EventType = typeof eventTypes[number];

interface PunchData {
  companyId: string;
  type: EventType;
  qrCodeId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  clientTimestamp: number;
  userAgent: string;
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const radius = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const latitude = radians(bLat - aLat);
  const longitude = radians(bLng - aLng);
  const value = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(aLat)) * Math.cos(radians(bLat))
    * Math.sin(longitude / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function saoPauloDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function expectedEvent(workday?: FirebaseFirestore.DocumentData): EventType | null {
  if (!workday?.clockInAt) return "clock_in";
  if (workday.status === "finished" || workday.clockOutAt) return null;
  if (workday.status === "on_break" && workday.breakStartAt && !workday.breakEndAt) return "break_end";
  if (workday.breakEndAt) return "clock_out";
  return "break_start";
}

function assertNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpsError("invalid-argument", `${field} inválido.`);
  }
}

export const registerPunch = onCall(
  { region, enforceAppCheck: false, cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Faça login novamente.");
    const data = request.data as PunchData;
    if (!data || !eventTypes.includes(data.type) || typeof data.companyId !== "string" || typeof data.qrCodeId !== "string") {
      throw new HttpsError("invalid-argument", "Dados do registro inválidos.");
    }
    assertNumber(data.latitude, "Latitude");
    assertNumber(data.longitude, "Longitude");
    assertNumber(data.accuracy, "Precisão");
    if (data.latitude < -90 || data.latitude > 90 || data.longitude < -180 || data.longitude > 180 || data.accuracy < 0) {
      throw new HttpsError("invalid-argument", "Coordenadas inválidas.");
    }

    const userRef = db.doc(`users/${request.auth.uid}`);
    const companyRef = db.doc(`companies/${data.companyId}`);
    const [userSnapshot, companySnapshot] = await Promise.all([userRef.get(), companyRef.get()]);
    if (!userSnapshot.exists) throw new HttpsError("permission-denied", "Perfil não encontrado.");
    const user = userSnapshot.data()!;
    const company = companySnapshot.data();
    if (!user.active || user.role !== "employee") throw new HttpsError("permission-denied", "Funcionário inativo ou inválido.");
    if (user.companyId !== data.companyId) throw new HttpsError("permission-denied", "Empresa não autorizada.");
    if (!companySnapshot.exists || !company?.active) throw new HttpsError("failed-precondition", "Empresa inativa ou inexistente.");
    if (company.qrCodeId !== data.qrCodeId) throw new HttpsError("failed-precondition", "QR Code antigo ou inválido.");

    const distanceMeters = haversine(data.latitude, data.longitude, company.latitude, company.longitude);
    if (distanceMeters + data.accuracy > company.radiusMeters) {
      throw new HttpsError("failed-precondition", "Localização fora do raio permitido.");
    }

    const date = saoPauloDate();
    const workdayRef = db.doc(`workdays/${data.companyId}_${request.auth.uid}_${date}`);
    const eventRef = workdayRef.collection("events").doc();
    const nowForCalculation = Timestamp.now();

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(workdayRef);
      const current = snapshot.exists ? snapshot.data() : undefined;
      if (expectedEvent(current) !== data.type) {
        throw new HttpsError("failed-precondition", "Esta não é a próxima ação da jornada.");
      }

      const timestampField: Record<EventType, string> = {
        clock_in: "clockInAt",
        break_start: "breakStartAt",
        break_end: "breakEndAt",
        clock_out: "clockOutAt",
      };
      const update: Record<string, unknown> = {
        companyId: data.companyId,
        userId: request.auth!.uid,
        date,
        [timestampField[data.type]]: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (data.type === "clock_in") Object.assign(update, {
        status: "working",
        createdAt: FieldValue.serverTimestamp(),
        totalWorkedMinutes: 0,
        totalBreakMinutes: 0,
      });
      if (data.type === "break_start") update.status = "on_break";
      if (data.type === "break_end") update.status = "working";
      if (data.type === "clock_out") {
        update.status = "finished";
        const clockIn = current?.clockInAt as Timestamp;
        const breakStart = current?.breakStartAt as Timestamp | undefined;
        const breakEnd = current?.breakEndAt as Timestamp | undefined;
        const breakMilliseconds = breakStart && breakEnd ? breakEnd.toMillis() - breakStart.toMillis() : 0;
        update.totalBreakMinutes = Math.max(0, Math.round(breakMilliseconds / 60_000));
        update.totalWorkedMinutes = Math.max(0, Math.round((nowForCalculation.toMillis() - clockIn.toMillis() - breakMilliseconds) / 60_000));
      }

      transaction.set(workdayRef, update, { merge: true });
      transaction.set(eventRef, {
        companyId: data.companyId,
        userId: request.auth!.uid,
        type: data.type,
        officialTimestamp: FieldValue.serverTimestamp(),
        clientTimestamp: Timestamp.fromMillis(data.clientTimestamp),
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
        distanceMeters,
        qrCodeId: data.qrCodeId,
        userAgent: String(data.userAgent || "").slice(0, 500),
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    const eventSnapshot = await eventRef.get();
    const officialTimestamp = eventSnapshot.get("officialTimestamp") as Timestamp;
    return { officialTimestampMillis: officialTimestamp.toMillis() };
  },
);
