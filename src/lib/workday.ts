import { doc, getDoc, Timestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
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
  error?: string;
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
  if (!auth.currentUser || auth.currentUser.uid !== userId) {
    throw new Error("Sua sessão expirou. Faça login novamente.");
  }

  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch("/api/ponto/registrar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      companyId,
      type,
      qrCodeId: validation.qrCodeId,
      latitude: validation.latitude,
      longitude: validation.longitude,
      accuracy: validation.accuracy,
      clientTimestamp: Date.now(),
      userAgent: navigator.userAgent,
    }),
  });

  let result: RegisterPunchResponse;
  try {
    result = await response.json() as RegisterPunchResponse;
  } catch {
    throw new Error("O servidor retornou uma resposta inválida.");
  }
  if (!response.ok) {
    if (response.status === 401) {
      await auth.currentUser?.getIdToken(true).catch(() => undefined);
    }
    throw new Error(result.error || "Não foi possível registrar o ponto.");
  }
  if (!Number.isFinite(result.officialTimestampMillis)) {
    throw new Error("O servidor não retornou o horário oficial.");
  }

  const workday = await getWorkday(userId, companyId);
  if (!workday) {
    throw new Error("O registro foi salvo, mas a jornada não pôde ser carregada.");
  }
  return {
    officialTimestamp: Timestamp.fromMillis(result.officialTimestampMillis),
    workday,
  };
}

export async function getWorkday(userId: string, companyId: string) {
  const id = `${companyId}_${userId}_${saoPauloDate()}`;
  const snapshot = await getDoc(doc(db, "workdays", id));
  if (!snapshot.exists()) return undefined;
  const workday = { ...snapshot.data(), id: snapshot.id } as Workday;
  if (workday.userId !== userId || workday.companyId !== companyId) {
    throw new Error("A jornada encontrada não pertence ao funcionário autenticado.");
  }
  return workday;
}
