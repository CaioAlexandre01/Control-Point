import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { PunchConflict, savePunch } from "./punch-service";
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
  requestId?: string;
  expectedWorkdayId?: string | null;
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

    assertNumber(data.clientTimestamp, "Horário do dispositivo");
    if (data.requestId !== undefined && (typeof data.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId))) {
      throw new HttpsError("invalid-argument", "Identificador de registro inválido.");
    }
    if (data.expectedWorkdayId !== undefined && data.expectedWorkdayId !== null && (typeof data.expectedWorkdayId !== "string" || data.expectedWorkdayId.includes("/"))) {
      throw new HttpsError("invalid-argument", "Turno inválido.");
    }
    try {
      return await savePunch(db, request.auth.uid, { ...data, userAgent: String(data.userAgent || "").slice(0, 500) }, distanceMeters, { FieldValue, Timestamp });
    } catch (error) {
      if (error instanceof PunchConflict) throw new HttpsError("failed-precondition", error.message);
      throw error;
    }
  },
);
