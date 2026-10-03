"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Clock3, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";
import { Alert, Button, Field, Loading } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import type { AppUser } from "@/types";
import { useInitialSetup } from "@/lib/use-initial-setup";

const schema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(6, "Mínimo de 6 caracteres"),
});
type Form = z.infer<typeof schema>;

const authErrors: Record<string, string> = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
  "auth/network-request-failed": "Sem conexão. Verifique sua internet.",
};

export default function Login() {
  const router = useRouter();
  const setupStatus = useInitialSetup();
  const { firebaseUser, profile, loading, authError } = useAuth();
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } =
    useForm<Form>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (setupStatus === "required") {
      router.replace("/setup");
      return;
    }
    if (setupStatus !== "ready") return;
    if (!loading && !isSubmitting && firebaseUser && profile?.active) {
      router.replace(profile.role === "admin" ? "/admin" : "/ponto");
    }
  }, [setupStatus, loading, isSubmitting, firebaseUser, profile, router]);

  async function submit(values: Form) {
    try {
      setError("");
      const credential = await signInWithEmailAndPassword(
        auth,
        values.email.trim().toLowerCase(),
        values.password,
      );
      const snapshot = await getDoc(doc(db, "users", credential.user.uid));
      if (!snapshot.exists()) {
        await signOut(auth);
        throw new Error("Perfil não encontrado. Procure o administrador.");
      }
      const user = { uid: snapshot.id, ...snapshot.data() } as AppUser;
      if (!user.active) {
        await signOut(auth);
        throw new Error("Seu acesso está inativo.");
      }
      // Navigate only after the provider and the validation above are ready.
    } catch (caught) {
      const code = typeof caught === "object" && caught && "code" in caught
        ? String(caught.code)
        : "";
      setError(authErrors[code] ?? (caught instanceof Error
        ? caught.message
        : "Não foi possível entrar."));
    }
  }

  async function recoverPassword() {
    const email = getValues("email").trim().toLowerCase();
    if (!z.string().email().safeParse(email).success) {
      setError("Informe seu e-mail acima para recuperar a senha.");
      return;
    }
    setResetting(true);
    setError("");
    setNotice("");
    try {
      await sendPasswordResetEmail(auth, email);
      setNotice("Se houver uma conta com esse e-mail, você receberá um link para redefinir sua senha. Confira também o spam.");
    } catch (caught) {
      const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "";
      if (code === "auth/user-not-found") {
        setNotice("Se houver uma conta com esse e-mail, você receberá um link para redefinir sua senha. Confira também o spam.");
      } else setError(authErrors[code] || "Não foi possível enviar a recuperação. Tente novamente.");
    } finally { setResetting(false); }
  }

  if (setupStatus === "error") return (
    <div className="center-page">
      <div>
        <Alert tone="error">Não foi possível verificar a configuração inicial. Verifique sua conexão e tente novamente.</Alert>
        <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
      </div>
    </div>
  );
  if (setupStatus !== "ready" || loading || (firebaseUser && profile?.active)) return <Loading />;

  return (
    <div className="auth-page">
      <div className="auth-copy">
        <div className="brand large">
          <span><Clock3 /></span>
          <b>Ponto <span>Uau</span></b>
        </div>
        <h1>Ponto certo.<br /><em>Sem complicação.</em></h1>
        <p>Jornada validada por QR Code, localização e horário oficial.</p>
        <div className="trust">
          <span>✓ Horário oficial</span>
          <span>✓ Validação de local</span>
          <span>✓ Histórico completo</span>
        </div>
      </div>
      <form className="auth-card" onSubmit={handleSubmit(submit)}>
        <div><h2>Bem-vindo</h2><p>Entre com suas credenciais</p></div>
        {(error || authError) && <Alert tone="error">{error || authError}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <Field
          label="E-mail"
          type="email"
          autoComplete="email"
          placeholder="voce@empresa.com"
          error={errors.email?.message}
          {...register("email")}
        />
        <div className="password">
          <Field
            label="Senha"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            error={errors.password?.message}
            {...register("password")}
          />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
            {show ? <EyeOff /> : <Eye />}
          </button>
        </div>
        <Button loading={isSubmitting}>Entrar</Button>
        <Button type="button" className="secondary" loading={resetting} onClick={recoverPassword}>Esqueci minha senha</Button>
        <small>Sem acesso? Solicite um convite ao administrador.</small>
      </form>
    </div>
  );
}
