import type { FieldValue, Timestamp, Firestore } from "firebase-admin/firestore";
import { expectedPunch, isOpenShift, punchFields, punchTypes, shiftDate, validateShiftSequence, workdayTimeZone } from "./workday-state";

export class PunchConflict extends Error {}

export interface PunchInput {
  companyId: string;
  type: typeof punchTypes[number];
  requestId?: string;
  expectedWorkdayId?: string | null;
  clientTimestamp: number;
  qrCodeId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  userAgent: string;
}

export async function savePunch(
  db: Firestore, userId: string, data: PunchInput, distanceMeters: number,
  sdk: { Timestamp: typeof Timestamp; FieldValue: typeof FieldValue },
) {
  // Next.js and Functions install separate SDK copies; use the caller's types.
  const { Timestamp, FieldValue } = sdk;
  const userRef = db.doc(`users/${userId}`);
  const freshRef = db.collection("workdays").doc();
  const receiptRef = data.requestId ? userRef.collection("punchRequests").doc(data.requestId) : undefined;
  return db.runTransaction(async transaction => {
    // A single employee document serializes even two first punches on different dates.
    const userSnapshot = await transaction.get(userRef);
    const user = userSnapshot.data();
    if (!user?.active || user.role !== "employee" || user.companyId !== data.companyId) {
      throw new PunchConflict("Funcionário inativo ou sem permissão.");
    }
    if (receiptRef) {
      const receipt = await transaction.get(receiptRef);
      if (receipt.exists) {
        if (receipt.get("type") !== data.type || receipt.get("companyId") !== data.companyId) {
          throw new PunchConflict("Identificador de registro já utilizado.");
        }
        return {
          officialTimestampMillis: receipt.get("officialTimestampMillis") as number,
          workdayId: receipt.get("workdayId") as string,
          workdayDate: receipt.get("workdayDate") as string,
        };
      }
    }
    const history = await transaction.get(db.collection("workdays")
      .where("companyId", "==", data.companyId).where("userId", "==", userId));
    const open = history.docs.filter(snapshot => isOpenShift(snapshot.data()));
    if (open.length > 1) throw new PunchConflict("Há mais de um turno aberto. Solicite a revisão dos registros ao administrador.");
    const selected = open[0];
    const current = selected?.data();
    const now = Timestamp.now();
    const date = current?.date ?? shiftDate(now.toDate());
    if (!selected && history.docs.some(snapshot => snapshot.get("date") === date && snapshot.get("status") === "day_off")) {
      throw new PunchConflict("Há uma folga programada nesta data.");
    }
    if (data.expectedWorkdayId !== undefined && data.expectedWorkdayId !== (selected?.id ?? null)) {
      throw new PunchConflict("O turno foi atualizado. Atualize a página antes de registrar.");
    }
    if (expectedPunch(current) !== data.type) {
      throw new PunchConflict("Esta não é a próxima ação permitida da jornada.");
    }
    const field = punchFields[punchTypes.indexOf(data.type)];
    const previous = punchFields[punchTypes.indexOf(data.type) - 1];
    if (previous && current?.[previous]?.toMillis() > now.toMillis()) {
      throw new PunchConflict("O horário anterior está no futuro. Solicite a revisão ao administrador.");
    }
    const workdayRef = selected?.ref ?? freshRef;
    const update: Record<string, unknown> = {
      companyId: data.companyId, userId, employeeName: user.name ?? "Funcionário",
      date, timeZone: workdayTimeZone, [field]: now, updatedAt: FieldValue.serverTimestamp(),
      status: data.type === "clock_out" ? "finished" : data.type === "break_start" ? "on_break" : "working",
    };
    if (!selected) Object.assign(update, { createdAt: now, totalWorkedMinutes: 0, totalBreakMinutes: 0 });
    try {
      Object.assign(update, validateShiftSequence({ ...current, [field]: now }));
    } catch (error) {
      throw new PunchConflict(error instanceof Error ? error.message : "Sequência de batidas inválida.");
    }
    const result = { officialTimestampMillis: now.toMillis(), workdayId: workdayRef.id, workdayDate: date as string };
    transaction.set(workdayRef, update, { merge: true });
    transaction.set(workdayRef.collection("events").doc(), {
      companyId: data.companyId, userId, type: data.type,
      officialTimestamp: now, timeZone: workdayTimeZone,
      clientTimestamp: Timestamp.fromMillis(data.clientTimestamp),
      latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy,
      distanceMeters, qrCodeId: data.qrCodeId, userAgent: data.userAgent,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(userRef, { lastPunchAt: now });
    if (receiptRef) transaction.create(receiptRef, { ...result, companyId: data.companyId, type: data.type });
    return result;
  });
}
