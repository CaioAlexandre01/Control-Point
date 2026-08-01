import { auth } from "./firebase";

interface AdminActionResponse {
  error?: string;
}

async function authenticatedDelete(path: string) {
  if (!auth.currentUser) throw new Error("Sua sessão expirou. Faça login novamente.");
  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch(path, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  let result: AdminActionResponse;
  try {
    result = await response.json() as AdminActionResponse;
  } catch {
    throw new Error("O servidor retornou uma resposta inválida.");
  }
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir a exclusão.");
}

export function deleteWorkday(workdayId: string) {
  return authenticatedDelete(`/api/admin/registros/${encodeURIComponent(workdayId)}`);
}

export function deleteEmployee(userId: string) {
  return authenticatedDelete(`/api/admin/funcionarios/${encodeURIComponent(userId)}`);
}
