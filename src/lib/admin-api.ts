import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export class AdminApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireAdmin(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AdminApiError(401, "Sessão ausente. Faça login novamente.");
  }

  const auth = getAdminAuth();
  const db = getAdminDb();
  let decodedToken;
  try {
    decodedToken = await auth.verifyIdToken(authorization.slice(7));
  } catch {
    throw new AdminApiError(401, "Sessão inválida ou expirada. Faça login novamente.");
  }

  const adminSnapshot = await db.doc(`users/${decodedToken.uid}`).get();
  if (!adminSnapshot.exists) throw new AdminApiError(403, "Perfil administrativo não encontrado.");
  const admin = adminSnapshot.data()!;
  if (!admin.active || admin.role !== "admin" || typeof admin.companyId !== "string") {
    throw new AdminApiError(403, "Você não tem permissão para realizar esta operação.");
  }

  return {
    adminId: decodedToken.uid,
    companyId: admin.companyId as string,
    auth,
    db,
  };
}

export function adminApiErrorResponse(caught: unknown) {
  if (caught instanceof AdminApiError) {
    return NextResponse.json({ error: caught.message }, { status: caught.status });
  }
  console.error("Erro em operação administrativa:", caught);
  return NextResponse.json({ error: "Não foi possível concluir a operação administrativa." }, { status: 500 });
}
