import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { MAX_LOCATION_ACCURACY } from "@/lib/point-permissions";
import type { EventType } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventTypes: EventType[] = ["clock_in", "break_start", "break_end", "clock_out"];

interface PunchBody {
  companyId: string;
  type: EventType;
  qrCodeId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  clientTimestamp: number;
  userAgent: string;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const earthRadius = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLat = radians(bLat - aLat);
  const deltaLng = radians(bLng - aLng);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(aLat)) * Math.cos(radians(bLat))
    * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
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
  if (workday.status === "on_break" && workday.breakStartAt && !workday.breakEndAt) {
    return "break_end";
  }
  if (workday.breakEndAt) return "clock_out";
  return "break_start";
}

function validateBody(value: unknown): PunchBody {
  if (!value || typeof value !== "object") throw new ApiError(400, "Dados do registro inválidos.");
  const body = value as Partial<PunchBody>;
  if (
    typeof body.companyId !== "string"
    || typeof body.qrCodeId !== "string"
    || !body.type
    || !eventTypes.includes(body.type)
  ) {
    throw new ApiError(400, "Empresa, QR Code ou tipo de registro inválido.");
  }
  for (const field of ["latitude", "longitude", "accuracy", "clientTimestamp"] as const) {
    if (typeof body[field] !== "number" || !Number.isFinite(body[field])) {
      throw new ApiError(400, `${field} inválido.`);
    }
  }
  if (
    body.latitude! < -90 || body.latitude! > 90
    || body.longitude! < -180 || body.longitude! > 180
    || body.accuracy! < 0
  ) {
    throw new ApiError(400, "Coordenadas ou precisão inválidas.");
  }
  return {
    companyId: body.companyId,
    type: body.type,
    qrCodeId: body.qrCodeId,
    latitude: body.latitude!,
    longitude: body.longitude!,
    accuracy: body.accuracy!,
    clientTimestamp: body.clientTimestamp!,
    userAgent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 500) : "",
  };
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError(401, "Sessão ausente. Faça login novamente.");
    }

    let decodedToken;
    try {
      decodedToken = await getAdminAuth().verifyIdToken(authorization.slice(7));
    } catch {
      throw new ApiError(401, "Sessão inválida ou expirada. Faça login novamente.");
    }

    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      throw new ApiError(400, "O corpo da requisição não é um JSON válido.");
    }
    const data = validateBody(requestBody);
    if (data.accuracy > MAX_LOCATION_ACCURACY) {
      throw new ApiError(
        422,
        "A localização está muito imprecisa. Ative a localização precisa do celular e tente novamente.",
      );
    }
    const db = getAdminDb();
    const userRef = db.doc(`users/${decodedToken.uid}`);
    const companyRef = db.doc(`companies/${data.companyId}`);
    const [userSnapshot, companySnapshot] = await Promise.all([
      userRef.get(),
      companyRef.get(),
    ]);

    if (!userSnapshot.exists) throw new ApiError(403, "Perfil não encontrado.");
    const user = userSnapshot.data()!;
    if (!user.active || user.role !== "employee") {
      throw new ApiError(403, "Funcionário inativo ou sem permissão.");
    }
    if (user.companyId !== data.companyId) {
      throw new ApiError(403, "Você não pode registrar ponto para outra empresa.");
    }
    if (!companySnapshot.exists) throw new ApiError(404, "Empresa não encontrada.");
    const company = companySnapshot.data()!;
    if (!company.active) throw new ApiError(403, "A empresa está inativa.");
    if (company.qrCodeId !== data.qrCodeId) {
      throw new ApiError(422, "QR Code antigo ou inválido.");
    }
    if (
      typeof company.latitude !== "number"
      || typeof company.longitude !== "number"
      || typeof company.radiusMeters !== "number"
    ) {
      throw new ApiError(422, "A localização da empresa não está configurada corretamente.");
    }

    const distanceMeters = haversine(
      data.latitude,
      data.longitude,
      company.latitude,
      company.longitude,
    );
    if (distanceMeters + data.accuracy > company.radiusMeters) {
      throw new ApiError(
        422,
        `Localização fora do raio permitido. Distância: ${Math.round(distanceMeters)} m; precisão: ${Math.round(data.accuracy)} m.`,
      );
    }

    const date = saoPauloDate();
    const workdayRef = db.doc(`workdays/${data.companyId}_${decodedToken.uid}_${date}`);
    const eventRef = workdayRef.collection("events").doc();
    const serverNow = Timestamp.now();

    await db.runTransaction(async (transaction) => {
      const workdaySnapshot = await transaction.get(workdayRef);
      const current = workdaySnapshot.exists ? workdaySnapshot.data() : undefined;
      const expected = expectedEvent(current);
      if (expected === null) throw new ApiError(409, "A jornada de hoje já foi encerrada.");
      if (expected !== data.type) {
        throw new ApiError(409, "Esta não é a próxima ação permitida da jornada.");
      }

      const timestampField: Record<EventType, string> = {
        clock_in: "clockInAt",
        break_start: "breakStartAt",
        break_end: "breakEndAt",
        clock_out: "clockOutAt",
      };
      const update: Record<string, unknown> = {
        companyId: data.companyId,
        userId: decodedToken.uid,
        date,
        [timestampField[data.type]]: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (data.type === "clock_in") {
        Object.assign(update, {
          status: "working",
          createdAt: FieldValue.serverTimestamp(),
          totalWorkedMinutes: 0,
          totalBreakMinutes: 0,
        });
      } else if (data.type === "break_start") {
        update.status = "on_break";
      } else if (data.type === "break_end") {
        update.status = "working";
      } else {
        update.status = "finished";
        const clockIn = current?.clockInAt as Timestamp;
        const breakStart = current?.breakStartAt as Timestamp | undefined;
        const breakEnd = current?.breakEndAt as Timestamp | undefined;
        const breakMilliseconds = breakStart && breakEnd
          ? breakEnd.toMillis() - breakStart.toMillis()
          : 0;
        update.totalBreakMinutes = Math.max(0, Math.round(breakMilliseconds / 60_000));
        update.totalWorkedMinutes = Math.max(
          0,
          Math.round((serverNow.toMillis() - clockIn.toMillis() - breakMilliseconds) / 60_000),
        );
      }

      transaction.set(workdayRef, update, { merge: true });
      transaction.set(eventRef, {
        companyId: data.companyId,
        userId: decodedToken.uid,
        type: data.type,
        officialTimestamp: FieldValue.serverTimestamp(),
        clientTimestamp: Timestamp.fromMillis(data.clientTimestamp),
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
        distanceMeters,
        qrCodeId: data.qrCodeId,
        userAgent: data.userAgent,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    const eventSnapshot = await eventRef.get();
    const officialTimestamp = eventSnapshot.get("officialTimestamp") as Timestamp;
    return NextResponse.json({
      officialTimestampMillis: officialTimestamp.toMillis(),
    });
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json({ error: caught.message }, { status: caught.status });
    }
    console.error("Erro ao registrar ponto:", caught);
    const message = caught instanceof Error && caught.message.includes("Firebase Admin não configurado")
      ? caught.message
      : "Não foi possível registrar o ponto. Tente novamente.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
