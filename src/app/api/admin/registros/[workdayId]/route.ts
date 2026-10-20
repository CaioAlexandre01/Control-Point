import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { isOpenShift, punchFields, validateShiftSequence, workdayTimeZone } from "../../../../../../functions/src/workday-state";
import { NextRequest, NextResponse } from "next/server";
import {
  AdminApiError,
  adminApiErrorResponse,
  requireAdmin,
} from "@/lib/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ workdayId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { adminId, companyId, db } = await requireAdmin(request);
    const { workdayId } = await context.params;
    if (!workdayId || workdayId.includes("/")) throw new AdminApiError(400, "Registro inválido.");
    const body = await request.json();
    if (!body || typeof body.reason !== "string" || body.reason.trim().length < 5
      || !["active", "day_off"].includes(body.mode)) {
      throw new AdminApiError(400, "Informe a situação e o motivo da correção.");
    }
    const times: Partial<Record<typeof punchFields[number], Timestamp>> = {};
    let calculated = { status: "day_off", totalWorkedMinutes: 0, totalBreakMinutes: 0 };
    if (body.mode === "active") {
      for (const field of punchFields) {
        const value = body.times?.[field];
        if (value != null) {
          if (!Number.isFinite(value) || value < -62135596800000 || value > 253402300799999) {
            throw new AdminApiError(400, "Horário inválido.");
          }
          times[field] = Timestamp.fromMillis(value);
        }
      }
      try {
        calculated = validateShiftSequence(times);
      } catch (error) {
        throw new AdminApiError(400, error instanceof Error ? error.message : "Sequência inválida.");
      }
    }
    const ref = db.doc(`workdays/${workdayId}`);
    const auditRef = db.collection("auditLogs").doc();
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.data();
      if (!current || current.companyId !== companyId) throw new AdminApiError(404, "Registro não encontrado.");
      if ((current.updatedAt?.toMillis() ?? null) !== body.expectedUpdatedAt) {
        throw new AdminApiError(409, "O registro foi atualizado. Recarregue os registros antes de corrigir.");
      }
      const userRef = db.doc(`users/${current.userId}`);
      const employee = await transaction.get(userRef);
      const history = await transaction.get(db.collection("workdays")
        .where("companyId", "==", companyId).where("userId", "==", current.userId));
      if (body.mode === "active" && !times.clockOutAt
        && history.docs.some(row => row.id !== workdayId && isOpenShift(row.data()))) {
        throw new AdminApiError(409, "O funcionário já possui outro turno aberto.");
      }
      const after = {
        clockInAt: times.clockInAt ?? null, breakStartAt: times.breakStartAt ?? null,
        breakEndAt: times.breakEndAt ?? null, clockOutAt: times.clockOutAt ?? null,
        ...calculated,
        date: current.date,
        timeZone: workdayTimeZone,
      };
      transaction.update(ref, { ...after, correctionAuditId: auditRef.id, updatedAt: FieldValue.serverTimestamp() });
      if (employee.exists) transaction.update(userRef, { lastPunchAt: FieldValue.serverTimestamp() });
      transaction.create(auditRef, {
        companyId, adminId, workdayId, workdayDate: after.date,
        action: "manual_workday_correction", reason: body.reason.trim(),
        before: current, after, createdAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch (caught) {
    if (caught instanceof SyntaxError) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
    return adminApiErrorResponse(caught);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { adminId, companyId, db } = await requireAdmin(request);
    const { workdayId } = await context.params;
    if (!workdayId || workdayId.includes("/")) {
      throw new AdminApiError(400, "Registro inválido.");
    }

    const workdayRef = db.doc(`workdays/${workdayId}`);
    const workdaySnapshot = await workdayRef.get();
    if (!workdaySnapshot.exists) throw new AdminApiError(404, "Registro não encontrado.");
    const workday = workdaySnapshot.data()!;
    if (workday.companyId !== companyId) {
      throw new AdminApiError(403, "Você não pode excluir registros de outra empresa.");
    }

    const eventsSnapshot = await workdayRef.collection("events").get();
    if (eventsSnapshot.size > 450) {
      throw new AdminApiError(409, "Este registro possui eventos demais para exclusão automática.");
    }

    const auditRef = db.collection("auditLogs").doc();
    const batch = db.batch();
    eventsSnapshot.docs.forEach((event) => batch.delete(event.ref));
    batch.delete(workdayRef);
    batch.set(auditRef, {
      companyId,
      adminId,
      action: "workday_deleted",
      reason: "Exclusão confirmada pelo administrador.",
      workdayId,
      workdayDate: workday.date,
      employeeId: workday.userId ?? null,
      before: workday,
      deletedEventCount: eventsSnapshot.size,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (caught) {
    return adminApiErrorResponse(caught);
  }
}
