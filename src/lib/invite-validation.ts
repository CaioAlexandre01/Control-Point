export function validateInvite(
  invite: { active?: boolean; used?: boolean; expiresAt?: { toMillis(): number } } | undefined,
  now: number,
) {
  if (!invite) return "Convite inválido ou cancelado.";
  if (invite.used) return "Este convite já foi utilizado. Entre com seu e-mail e senha na página de login.";
  if (!invite.active) return "Este convite foi cancelado.";
  if (!invite.expiresAt || invite.expiresAt.toMillis() <= now) return "Este convite expirou.";
  return null;
}
