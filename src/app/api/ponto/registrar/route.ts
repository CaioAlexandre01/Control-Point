import { PunchConflict, savePunch } from "../../../../../functions/src/punch-service";
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
  requestId?: string;
  expectedWorkdayId?: string | null;
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
  if (body.requestId !== undefined && (typeof body.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId))) {
    throw new ApiError(400, "Identificador de registro inválido.");
  }
  if (body.expectedWorkdayId !== undefined && body.expectedWorkdayId !== null && (typeof body.expectedWorkdayId !== "string" || body.expectedWorkdayId.includes("/"))) {
    throw new ApiError(400, "Turno inválido.");
  }
  return {
    requestId: body.requestId,
    expectedWorkdayId: body.expectedWorkdayId,
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

export async function GET() {
  return NextResponse.json({ date: saoPauloDate() }, { headers: { "Cache-Control": "no-store" } });
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

    const result = await savePunch(db, decodedToken.uid, data, distanceMeters, { FieldValue, Timestamp });
    return NextResponse.json(result);
  } catch (caught) {
    if (caught instanceof PunchConflict) return NextResponse.json({ error: caught.message }, { status: 409 });
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
