import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { validateInvite } from "@/lib/invite-validation";
import { activateInvite, InviteError } from "@/lib/activate-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headers = { "Cache-Control": "no-store" };
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return NextResponse.json({ error: "Link de ativação inválido." }, { status: 400, headers });
  }
  try {
    const snapshot = await getAdminDb().doc(`invites/${token}`).get();
    const invite = snapshot.data();
    const error = validateInvite(invite, Date.now());
    if (error) return NextResponse.json({ error }, { status: 410, headers });
    return NextResponse.json({ email: invite!.email }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível validar o convite. Tente novamente." }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return NextResponse.json({ error: "Link de ativação inválido." }, { status: 400, headers });
  }
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new InviteError(401, "Entre para concluir a ativação.");
    let user;
    try { user = await getAdminAuth().verifyIdToken(authorization.slice(7), true); }
    catch { throw new InviteError(401, "Sua sessão expirou. Entre novamente para concluir a ativação."); }
    const body = await request.json().catch(() => null);
    if (typeof body?.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 120) {
      throw new InviteError(400, "Informe seu nome completo (entre 2 e 120 caracteres).");
    }
    await activateInvite(getAdminDb(), token, user, body.name.trim());
    return NextResponse.json({ ok: true }, { headers });
  } catch (caught) {
    const status = caught instanceof InviteError ? caught.status : 503;
    const error = caught instanceof InviteError ? caught.message
      : "Não foi possível concluir a ativação. Tente novamente com o mesmo e-mail e senha.";
    return NextResponse.json({ error }, { status, headers });
  }
}
