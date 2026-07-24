import { doc, getDoc, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import { saoPauloDate } from "./utils";
import type { EventType, Validation, Workday } from "@/types";

export function nextEvent(workday?: Workday): EventType | null {
  if (!workday?.clockInAt) return "clock_in";
  if (workday.status === "finished" || workday.clockOutAt) return null;
  if (workday.status === "on_break" && workday.breakStartAt && !workday.breakEndAt) {
    return "break_end";
  }
  if (workday.breakEndAt) return "clock_out";
  return "break_start";
}

interface RegisterPunchResponse {
  officialTimestampMillis: number;
}

export async function registerPunch(
  userId: string,
  companyId: string,
  type: EventType,
  validation: Validation,
) {
  if (validation.company.id !== companyId) {
    throw new Error("O QR Code não pertence à sua empresa.");
  }
  if (Date.now() - validation.validatedAt > 120_000) {
    throw new Error("A validação expirou. Leia o QR Code novamente.");
  }

  const call = httpsCallable<{
    companyId: string;
    type: EventType;
    qrCodeId: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    clientTimestamp: number;
    userAgent: string;
  }, RegisterPunchResponse>(functions, "registerPunch");

  const response = await call({
    companyId,
    type,
    qrCodeId: validation.qrCodeId,
    latitude: validation.latitude,
    longitude: validation.longitude,
    accuracy: validation.accuracy,
    clientTimestamp: Date.now(),
    userAgent: navigator.userAgent,
  });
  const workday = await getWorkday(userId, companyId);
  if (!workday) throw new Error("O registro foi salvo, mas a jornada não pôde ser carregada.");
  return {
    officialTimestamp: Timestamp.fromMillis(response.data.officialTimestampMillis),
    workday,
  };
}

export async function getWorkday(userId: string, companyId: string) {
  const id = `${companyId}_${userId}_${saoPauloDate()}`;
  const snapshot = await getDoc(doc(db, "workdays", id));
  return snapshot.exists()
    ? ({ id: snapshot.id, ...snapshot.data() } as Workday)
    : undefined;
}
