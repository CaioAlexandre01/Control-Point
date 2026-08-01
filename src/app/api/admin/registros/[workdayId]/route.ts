import { FieldValue } from "firebase-admin/firestore";
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
