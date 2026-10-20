import { collection, doc, getDocFromServer, getDocsFromServer, query, where, Timestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
import { randomToken } from "./utils";
import { expectedPunch, isOpenShift } from "../../functions/src/workday-state";
import type { EventType, Validation, Workday } from "@/types";

export function nextEvent(workday?: Workday): EventType | null {
  if (workday?.clockOutAt) return "clock_in";
  return expectedPunch(workday);
}

const requestIds = new WeakMap<Validation, string>();

interface RegisterPunchResponse {
  officialTimestampMillis: number;
  workdayDate?: string;
  workdayId: string;
  error?: string;
}

export async function registerPunch(
  userId: string,
  companyId: string,
  type: EventType,
  validation: Validation,
  expectedWorkdayId: string | null,
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

  const requestId = requestIds.get(validation) ?? randomToken(16);
  requestIds.set(validation, requestId);
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
      requestId,
      expectedWorkdayId,
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

  const snapshot = await getDocFromServer(doc(db, "workdays", result.workdayId));
  const workday = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as Workday : undefined;
  if (!workday || workday.userId !== userId || workday.companyId !== companyId) {
    throw new Error("O registro foi salvo, mas a jornada não pôde ser carregada.");
  }
  return {
    officialTimestamp: Timestamp.fromMillis(result.officialTimestampMillis),
    workday,
  };
}

export async function getWorkday(userId: string, companyId: string) {
  const response = await fetch("/api/ponto/registrar", { cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.date !== "string") throw new Error("Não foi possível consultar o dia oficial. Tente novamente.");
  const snapshot = await getDocsFromServer(query(collection(db, "workdays"),
    where("companyId", "==", companyId), where("userId", "==", userId)));
  const rows = snapshot.docs.map(row => ({ ...row.data(), id: row.id } as Workday));
  const open = rows.filter(isOpenShift);
  if (open.length > 1) throw new Error("Há mais de um turno aberto. Solicite a revisão ao administrador.");
  if (open.length) return open[0];
  const dayOff = rows.find(row => row.date === result.date && row.status === "day_off");
  if (dayOff) return dayOff;
  return rows.filter(row => row.clockOutAt)
    .sort((a, b) => b.clockOutAt!.toMillis() - a.clockOutAt!.toMillis())[0];
}
