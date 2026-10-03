import { auth } from "./firebase";

interface AdminActionResponse {
  error?: string;
}

async function authenticatedRequest<T extends AdminActionResponse>(path: string, init: RequestInit) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sua sessão expirou. Faça login novamente.");
  const send = async (forceRefresh: boolean) => {
    const idToken = await user.getIdToken(forceRefresh);
    return fetch(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${idToken}` },
    });
  };
  let response = await send(false);
  // The device clock can leave a locally cached token looking valid after expiry.
  // All admin routes reject unauthorized requests before performing any mutation.
  if (response.status === 401 && auth.currentUser?.uid === user.uid) response = await send(true);

  let result: T;
  try {
    result = await response.json() as T;
  } catch {
    throw new Error("O servidor retornou uma resposta inválida.");
  }
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir a operação.");
  return result;
}

async function authenticatedDelete(path: string) {
  await authenticatedRequest<AdminActionResponse>(path, { method: "DELETE" });
}

export function deleteWorkday(workdayId: string) {
  return authenticatedDelete(`/api/admin/registros/${encodeURIComponent(workdayId)}`);
}

export function deleteEmployee(userId: string) {
  return authenticatedDelete(`/api/admin/funcionarios/${encodeURIComponent(userId)}`);
}

export interface InviteRow {
  id: string; email: string; active: boolean; used: boolean; expiresAt: number;
  status: "used" | "canceled" | "expired" | "pending";
}

export function listInvites() {
  return authenticatedRequest<AdminActionResponse & { invites: InviteRow[] }>("/api/admin/convites", { cache: "no-store" });
}

export function createEmployeeInvite(email: string) {
  return authenticatedRequest<AdminActionResponse & { token: string }>("/api/admin/convites", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });
}

export function updateEmployeeInvite(token: string, action: "renew" | "cancel") {
  return authenticatedRequest<AdminActionResponse & { ok: boolean }>("/api/admin/convites", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action }),
  });
}

export type SystemResetMode = "hours" | "all";

interface SystemResetResponse extends AdminActionResponse {
  ok: boolean;
  mode: SystemResetMode;
  deleted: {
    workdays: number;
    auditLogs: number;
    invites?: number;
    users?: number;
  };
}

export function resetSystem(mode: SystemResetMode) {
  return authenticatedRequest<SystemResetResponse>("/api/admin/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}
