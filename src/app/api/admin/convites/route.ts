import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AdminApiError, adminApiErrorResponse, requireAdmin } from "@/lib/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const lifetime = 7 * 86_400_000;

export async function GET(request: NextRequest) {
  try {
    const { db, companyId } = await requireAdmin(request);
    const snapshot = await db.collection("invites").where("companyId", "==", companyId).get();
    const serverNow = Date.now();
    const invites = snapshot.docs.map((doc) => {
      const data = doc.data();
      const expiresAt = data.expiresAt?.toMillis() ?? 0;
      return { id: doc.id, email: data.email, active: data.active, used: data.used, expiresAt,
        status: data.used ? "used" : !data.active ? "canceled" : expiresAt <= serverNow ? "expired" : "pending" };
    }).sort((a, b) => b.expiresAt - a.expiresAt);
    return NextResponse.json({ invites }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) { return adminApiErrorResponse(caught); }
}

export async function POST(request: NextRequest) {
  try {
    const { db, companyId } = await requireAdmin(request);
    const body = await request.json().catch(() => null);
    const email = z.string().trim().toLowerCase().email().safeParse(body?.email);
    if (!email.success) throw new AdminApiError(400, "Informe um e-mail válido.");
    const token = randomBytes(24).toString("hex");
    await db.doc(`invites/${token}`).create({
      token, companyId, email: email.data, role: "employee", active: true, used: false,
      expiresAt: Timestamp.fromMillis(Date.now() + lifetime), createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ token });
  } catch (caught) { return adminApiErrorResponse(caught); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, companyId, adminId } = await requireAdmin(request);
    const body = await request.json().catch(() => null);
    if (!/^[a-f0-9]{48}$/.test(body?.token ?? "") || !["renew", "cancel"].includes(body?.action)) {
      throw new AdminApiError(400, "Convite ou ação inválida.");
    }
    const ref = db.doc(`invites/${body.token}`);
    await db.runTransaction(async (transaction) => {
      const invite = (await transaction.get(ref)).data();
      if (!invite || invite.companyId !== companyId) throw new AdminApiError(404, "Convite não encontrado.");
      if (invite.used) throw new AdminApiError(409, "Este convite já foi utilizado. O funcionário deve entrar ou recuperar a senha.");
      transaction.update(ref, body.action === "renew" ? {
        active: true, expiresAt: Timestamp.fromMillis(Date.now() + lifetime),
        renewedAt: FieldValue.serverTimestamp(), renewedBy: adminId,
        canceledAt: FieldValue.delete(), canceledBy: FieldValue.delete(),
      } : { active: false, canceledAt: FieldValue.serverTimestamp(), canceledBy: adminId });
    });
    return NextResponse.json({ ok: true });
  } catch (caught) { return adminApiErrorResponse(caught); }
}
