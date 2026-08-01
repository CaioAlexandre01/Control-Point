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
  params: Promise<{ userId: string }>;
}

function firebaseErrorCode(caught: unknown) {
  if (!caught || typeof caught !== "object" || !("code" in caught)) return "";
  const code = (caught as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { adminId, companyId, auth, db } = await requireAdmin(request);
    const { userId } = await context.params;
    if (!userId || userId.includes("/")) throw new AdminApiError(400, "Funcionário inválido.");
    if (userId === adminId) throw new AdminApiError(409, "Você não pode excluir sua própria conta.");

    const userRef = db.doc(`users/${userId}`);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) throw new AdminApiError(404, "Funcionário não encontrado.");
    const employee = userSnapshot.data()!;
    if (employee.companyId !== companyId || employee.role !== "employee") {
      throw new AdminApiError(403, "Você não pode excluir este usuário.");
    }

    const employeeName = typeof employee.name === "string" ? employee.name : "Funcionário excluído";
    const workdaysSnapshot = await db.collection("workdays").where("userId", "==", userId).get();
    const companyWorkdays = workdaysSnapshot.docs.filter(
      (workday) => workday.data().companyId === companyId,
    );

    for (let index = 0; index < companyWorkdays.length; index += 400) {
      const batch = db.batch();
      companyWorkdays.slice(index, index + 400).forEach((workday) => {
        batch.update(workday.ref, {
          employeeName,
          employeeDeletedAt: FieldValue.serverTimestamp(),
          employeeDeletedBy: adminId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }

    try {
      await auth.deleteUser(userId);
    } catch (caught) {
      if (firebaseErrorCode(caught) !== "auth/user-not-found") throw caught;
    }

    const auditRef = db.collection("auditLogs").doc();
    const batch = db.batch();
    batch.delete(userRef);
    batch.set(auditRef, {
      companyId,
      adminId,
      action: "employee_deleted",
      reason: "Exclusão confirmada pelo administrador.",
      employeeId: userId,
      employeeName,
      employeeEmail: typeof employee.email === "string" ? employee.email : null,
      preservedWorkdayCount: companyWorkdays.length,
      before: {
        name: employeeName,
        email: typeof employee.email === "string" ? employee.email : null,
        active: employee.active === true,
        role: employee.role,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return NextResponse.json({ ok: true, preservedWorkdayCount: companyWorkdays.length });
  } catch (caught) {
    return adminApiErrorResponse(caught);
  }
}
