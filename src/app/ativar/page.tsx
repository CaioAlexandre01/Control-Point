"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Alert, Button, Card, Field, Loading } from "@/components/ui";

const schema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  name: z.string().trim().min(2, "Informe seu nome").max(120, "Use até 120 caracteres"),
  password: z.string().min(6, "Use pelo menos 6 caracteres"),
});
type Form = z.infer<typeof schema>;

class InviteLoadError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function loadInvite(token: string): Promise<{ email: string }> {
  const response = await fetch(`/api/convites/${encodeURIComponent(token)}`, { cache: "no-store" });
  const result = await response.json().catch(() => { throw new Error("Não foi possível validar o convite. Atualize a página e tente novamente."); });
  if (!response.ok) throw new InviteLoadError(result.error || "Não foi possível validar o convite.", result.code);
  return result;
}

export default function ActivatePage() {
  return <Suspense fallback={<Loading />}><Activate /></Suspense>;
}

function Activate() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const { profile, loading } = useAuth();
  const [activated, setActivated] = useState(false);
  const [invite, setInvite] = useState<{ email: string }>();
  const [checking, setChecking] = useState(true);
  const [alreadyActivated, setAlreadyActivated] = useState(false);
  const [error, setError] = useState("");
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } =
    useForm<Form>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!loading && profile?.active && profile.role === "employee" && profile.inviteId === token) router.replace("/ponto");
  }, [loading, profile, token, router]);

  useEffect(() => {
    let active = true;
    setActivated(false);
    setAlreadyActivated(false);
    setInvite(undefined);
    setError("");
    setChecking(true);
    if (!token) {
      setError("Link de ativação inválido.");
      setChecking(false);
      return;
    }
    loadInvite(token).then((data) => {
      if (!active) return;
      setInvite(data);
      setValue("email", data.email);
    }).catch((caught) => {
      if (!active) return;
      if (caught instanceof InviteLoadError && caught.code === "already-activated") {
        setAlreadyActivated(true);
        return;
      }
      setError(caught instanceof Error ? caught.message : "Não foi possível validar o convite.");
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [token, setValue]);

  async function submit(values: Form) {
    if (!token || !invite) return;
    try {
      setError("");
      if (values.email.trim().toLowerCase() !== invite.email.toLowerCase()) {
        throw new Error("O e-mail deve ser o mesmo do convite.");
      }
      let user = auth.currentUser;
      if (user?.email?.toLowerCase() !== invite.email.toLowerCase()) {
        try {
          user = (await createUserWithEmailAndPassword(auth, invite.email, values.password)).user;
        } catch (caught) {
          if (!caught || typeof caught !== "object" || !("code" in caught) || caught.code !== "auth/email-already-in-use") throw caught;
          // Resume an interrupted activation only after authenticating its owner.
          user = (await signInWithEmailAndPassword(auth, invite.email, values.password)).user;
        }
      }
      const idToken = await user!.getIdToken();
      const response = await fetch(`/api/convites/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ name: values.name }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Não foi possível confirmar a ativação. Tente novamente com os mesmos dados.");
      setActivated(true);
    } catch (caught) {
      // Never delete the identity after a timeout: the transaction may have committed.
      const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "";
      const messages: Record<string, string> = {
        "auth/invalid-credential": "Este e-mail já possui uma conta. Use sua senha cadastrada ou recupere o acesso na página de login.",
        "auth/weak-password": "Use uma senha com pelo menos 6 caracteres.",
        "auth/network-request-failed": "Sem conexão. Tente novamente com os mesmos dados.",
        "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      };
      setError(messages[code] || (caught instanceof Error ? caught.message : "Falha ao ativar a conta."));
    }
  }

  if (checking) return <Loading />;
  return (
    <div className="center-page">
      <Card className="activation">
        <span className="eyebrow">Ativação de conta</span>
        <h1>{activated ? "Conta ativada" : alreadyActivated ? "Continue seu acesso" : invite ? "Crie seu acesso" : "Convite indisponível"}</h1>
        {alreadyActivated && <Alert>Já existe uma conta associada a este convite. Entre com seu e-mail e senha. Se não souber a senha, use “Esqueci minha senha” na página de login.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {activated && <Alert tone="success">Carregando seu acesso… Se a página não abrir automaticamente, use o login abaixo.</Alert>}
        {invite && !activated && (
          <form onSubmit={handleSubmit(submit)}>
            <Field label="E-mail" type="email" readOnly error={errors.email?.message} {...register("email")} />
            <Field label="Nome completo" autoComplete="name" error={errors.name?.message} {...register("name")} />
            <Field label="Senha" type="password" autoComplete="new-password" error={errors.password?.message} {...register("password")} />
            <Button loading={isSubmitting}>Ativar minha conta</Button>
          </form>
        )}
        <p><Link href="/login">Entrar ou recuperar minha senha</Link></p>
      </Card>
    </div>
  );
}
