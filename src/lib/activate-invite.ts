import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { validateInvite } from "./invite-validation";

export class InviteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function activateInvite(
  db: Firestore,
  token: string,
  user: { uid: string; email?: string },
  name: string,
) {
  const inviteRef = db.doc(`invites/${token}`);
  const profileRef = db.doc(`users/${user.uid}`);
  await db.runTransaction(async (transaction) => {
    const [inviteSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(inviteRef), transaction.get(profileRef),
    ]);
    const invite = inviteSnapshot.data();
    const profile = profileSnapshot.data();
    if (!invite || !user.email || invite.email !== user.email.toLowerCase()) {
      throw new InviteError(403, "Este convite não pertence ao e-mail autenticado.");
    }
    // A lost response must be safe to retry, even after the invite expires.
    if (invite.used && invite.usedBy === user.uid && profile?.inviteId === token
      && profile.companyId === invite.companyId && profile.active) return;
    const error = validateInvite(invite, Date.now());
    if (error) throw new InviteError(410, error);
    if (profile) throw new InviteError(409, "Esta conta já possui um perfil. Entre pela página de login.");
    if (invite.role !== "employee" || typeof invite.companyId !== "string" || invite.companyId.includes("/")) {
      throw new InviteError(410, "Convite inválido. Solicite um novo convite ao administrador.");
    }
    const company = await transaction.get(db.doc(`companies/${invite.companyId}`));
    if (!company.data()?.active) throw new InviteError(403, "A empresa deste convite está inativa.");
    transaction.create(profileRef, {
      name, email: invite.email, role: "employee", companyId: invite.companyId,
      active: true, inviteId: token,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(inviteRef, {
      active: false, used: true, usedBy: user.uid, usedAt: FieldValue.serverTimestamp(),
    });
  });
}
