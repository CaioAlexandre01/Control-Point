import type { Firestore, Query } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import {
  AdminApiError,
  adminApiErrorResponse,
  requireAdmin,
} from "@/lib/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResetMode = "hours" | "all";

async function deleteRefs(db: Firestore, refs: FirebaseFirestore.DocumentReference[]) {
  let deleted = 0;
  for (let index = 0; index < refs.length; index += 400) {
    const group = refs.slice(index, index + 400);
    const batch = db.batch();
    group.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += group.length;
  }
  return deleted;
}

async function deleteQuery(db: Firestore, query: Query, recursive = false) {
  let deleted = 0;
  while (true) {
    const snapshot = await query.limit(100).get();
    if (snapshot.empty) return deleted;

    if (recursive) {
      for (let index = 0; index < snapshot.docs.length; index += 10) {
        await Promise.all(
          snapshot.docs.slice(index, index + 10).map((document) => db.recursiveDelete(document.ref)),
        );
      }
    } else {
      await deleteRefs(db, snapshot.docs.map((document) => document.ref));
    }
    deleted += snapshot.size;
  }
}

async function deleteAuthUsers(
  auth: Awaited<ReturnType<typeof requireAdmin>>["auth"],
  userIds: string[],
) {
  for (let index = 0; index < userIds.length; index += 1000) {
    const result = await auth.deleteUsers(userIds.slice(index, index + 1000));
    if (result.failureCount > 0) {
      throw new Error("Não foi possível excluir todas as contas de acesso.");
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const { adminId, companyId, auth, db } = await requireAdmin(request);
    let body: { mode?: unknown };
    try {
      body = await request.json() as { mode?: unknown };
    } catch {
      throw new AdminApiError(400, "Solicitação de reset inválida.");
    }
    if (body.mode !== "hours" && body.mode !== "all") {
      throw new AdminApiError(400, "Escolha um tipo de reset válido.");
    }
    const mode: ResetMode = body.mode;

    const workdays = await deleteQuery(
      db,
      db.collection("workdays").where("companyId", "==", companyId),
      true,
    );

    const auditQuery = db.collection("auditLogs").where("companyId", "==", companyId);
    let auditLogs = 0;
    if (mode === "hours") {
      const auditSnapshot = await auditQuery.get();
      const timeAuditRefs = auditSnapshot.docs
        .filter((document) => {
          const data = document.data();
          return typeof data.workdayId === "string"
            || data.action === "manual_workday_correction"
            || data.action === "workday_deleted";
        })
        .map((document) => document.ref);
      auditLogs = await deleteRefs(db, timeAuditRefs);
      return NextResponse.json({
        ok: true,
        mode,
        deleted: { workdays, auditLogs },
      });
    }

    auditLogs = await deleteQuery(db, auditQuery);
    const invites = await deleteQuery(
      db,
      db.collection("invites").where("companyId", "==", companyId),
    );

    const usersSnapshot = await db.collection("users").where("companyId", "==", companyId).get();
    const otherUsers = usersSnapshot.docs.filter((document) => document.id !== adminId);
    await deleteAuthUsers(auth, otherUsers.map((document) => document.id));
    await deleteRefs(db, otherUsers.map((document) => document.ref));

    await auth.deleteUser(adminId);
    const finalBatch = db.batch();
    finalBatch.delete(db.doc(`users/${adminId}`));
    finalBatch.delete(db.doc(`companies/${companyId}`));
    finalBatch.delete(db.doc("system/config"));
    await finalBatch.commit();

    return NextResponse.json({
      ok: true,
      mode,
      deleted: {
        workdays,
        auditLogs,
        invites,
        users: usersSnapshot.size,
      },
    });
  } catch (caught) {
    return adminApiErrorResponse(caught);
  }
}
