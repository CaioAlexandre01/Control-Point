"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createUserWithEmailAndPassword, deleteUser, signOut } from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";
import { Alert, Button, Card, Field, Loading } from "@/components/ui";

const schema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  name: z.string().min(2, "Informe seu nome"),
  password: z.string().min(6, "Use pelo menos 6 caracteres"),
});
type Form = z.infer<typeof schema>;

interface Invite {
  companyId: string;
  email: string;
  role: "employee";
  active: boolean;
  used: boolean;
  expiresAt?: { toMillis(): number };
}

export default function ActivatePage() {
  return <Suspense fallback={<Loading />}><Activate /></Suspense>;
}

function Activate() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [invite, setInvite] = useState<Invite>();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } =
    useForm<Form>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!token) {
      setError("Link de ativação inválido.");
      setChecking(false);
      return;
    }
    getDoc(doc(db, "invites", token)).then((snapshot) => {
      if (!snapshot.exists()) throw new Error("Convite inválido ou cancelado.");
      const data = snapshot.data() as Invite;
      if (!data.active || data.used) throw new Error("Este convite não está mais disponível.");
      if (!data.expiresAt || data.expiresAt.toMillis() <= Date.now()) throw new Error("Este convite expirou.");
      setInvite(data);
      setValue("email", data.email);
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Não foi possível validar o convite.");
    }).finally(() => setChecking(false));
  }, [token, setValue]);

  async function submit(values: Form) {
    if (!token || !invite) return;
    let createdUser: typeof auth.currentUser = null;
    try {
      setError("");
      if (values.email.trim().toLowerCase() !== invite.email.toLowerCase()) {
        throw new Error("O e-mail deve ser o mesmo do convite.");
      }
      const credential = await createUserWithEmailAndPassword(
        auth,
        invite.email.toLowerCase(),
        values.password,
      );
      createdUser = credential.user;
      const inviteRef = doc(db, "invites", token);
      const userRef = doc(db, "users", credential.user.uid);

      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(inviteRef);
        if (!snapshot.exists()) throw new Error("Convite não encontrado.");
        const current = snapshot.data() as Invite;
        if (!current.active || current.used) throw new Error("Este convite já foi utilizado.");
        if (!current.expiresAt || current.expiresAt.toMillis() <= Date.now()) throw new Error("Este convite expirou.");
        if (credential.user.email?.toLowerCase() !== current.email.toLowerCase()) {
          throw new Error("O e-mail autenticado não corresponde ao convite.");
        }
        transaction.set(userRef, {
          name: values.name.trim(),
          email: current.email.toLowerCase(),
          role: "employee",
          companyId: current.companyId,
          active: true,
          inviteId: token,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        transaction.update(inviteRef, {
          active: false,
          used: true,
          usedAt: serverTimestamp(),
          usedBy: credential.user.uid,
        });
      });
      router.replace("/ponto");
    } catch (caught) {
      if (createdUser) {
        try { await deleteUser(createdUser); } catch { await signOut(auth); }
      }
      setError(caught instanceof Error ? caught.message : "Falha ao ativar a conta.");
    }
  }

  if (checking) return <Loading />;
  return (
    <div className="center-page">
      <Card className="activation">
        <span className="eyebrow">Ativação de conta</span>
        <h1>{invite ? "Crie seu acesso" : "Convite indisponível"}</h1>
        {error && <Alert tone="error">{error}</Alert>}
        {invite && (
          <form onSubmit={handleSubmit(submit)}>
            <Field label="E-mail" type="email" readOnly error={errors.email?.message} {...register("email")} />
            <Field label="Nome completo" autoComplete="name" error={errors.name?.message} {...register("name")} />
            <Field label="Senha" type="password" autoComplete="new-password" error={errors.password?.message} {...register("password")} />
            <Button loading={isSubmitting}>Ativar minha conta</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
