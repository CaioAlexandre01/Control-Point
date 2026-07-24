"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createUserWithEmailAndPassword, deleteUser } from "firebase/auth";
import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";
import { Alert, Button, Card, Field, Loading } from "@/components/ui";
import { randomToken } from "@/lib/utils";

const schema = z.object({
  companyName: z.string().min(2, "Informe o nome da empresa"),
  document: z.string().min(8, "Informe o documento"),
  name: z.string().min(2, "Informe seu nome"),
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(6, "Use pelo menos 6 caracteres"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().min(10).max(1000),
});
type Form = z.infer<typeof schema>;

const firebaseErrors: Record<string, string> = {
  "auth/configuration-not-found": "Ative o Firebase Authentication e o provedor E-mail/Senha no Console do Firebase.",
  "auth/email-already-in-use": "Este e-mail já possui uma conta no Firebase Authentication.",
  "auth/invalid-email": "O e-mail informado é inválido.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/network-request-failed": "Não foi possível conectar ao Firebase. Verifique sua internet.",
  "permission-denied": "O Firestore recusou a configuração. Publique as regras do projeto antes de continuar.",
};

function setupErrorMessage(caught: unknown) {
  const code = typeof caught === "object" && caught && "code" in caught
    ? String(caught.code).replace("firestore/", "")
    : "";
  return firebaseErrors[code]
    ?? (caught instanceof Error ? caught.message : "Falha na configuração.");
}

export default function Setup() {
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<Form>({ resolver: zodResolver(schema), defaultValues: { radiusMeters: 100 } });

  useEffect(() => {
    getDoc(doc(db, "system", "config"))
      .then((snapshot) => setBlocked(snapshot.exists()))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível verificar o setup."))
      .finally(() => setChecking(false));
  }, []);

  async function submit(values: Form) {
    let createdUser: typeof auth.currentUser = null;
    try {
      setError("");
      const config = await getDoc(doc(db, "system", "config"));
      if (config.exists()) {
        setBlocked(true);
        throw new Error("O sistema já foi configurado.");
      }
      const credential = await createUserWithEmailAndPassword(
        auth,
        values.email.trim().toLowerCase(),
        values.password,
      );
      createdUser = credential.user;
      const companyId = randomToken(10);
      const batch = writeBatch(db);
      batch.set(doc(db, "companies", companyId), {
        name: values.companyName.trim(),
        document: values.document.trim(),
        active: true,
        qrCodeId: randomToken(16),
        latitude: values.latitude,
        longitude: values.longitude,
        radiusMeters: values.radiusMeters,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "users", credential.user.uid), {
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        role: "admin",
        companyId,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "system", "config"), {
        initialized: true,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      router.replace("/admin");
    } catch (caught) {
      if (createdUser) {
        try { await deleteUser(createdUser); } catch { /* Firebase may require a recent login. */ }
      }
      setError(setupErrorMessage(caught));
    }
  }

  if (checking) return <Loading />;
  if (blocked) {
    return (
      <div className="center-page">
        <Card>
          <h1>Sistema já configurado</h1>
          <p>O setup inicial está bloqueado.</p>
          <Button onClick={() => router.push("/login")}>Ir para o login</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="setup-page">
      <div><span className="eyebrow">Configuração inicial</span><h1>Prepare sua empresa</h1></div>
      <Card>
        <form onSubmit={handleSubmit(submit)}>
          {error && <Alert tone="error">{error}</Alert>}
          <h2>Empresa</h2>
          <div className="form-grid">
            <Field label="Nome da empresa" error={errors.companyName?.message} {...register("companyName")} />
            <Field label="CNPJ / documento" error={errors.document?.message} {...register("document")} />
            <Field label="Latitude" type="number" step="any" error={errors.latitude?.message} {...register("latitude", { valueAsNumber: true })} />
            <Field label="Longitude" type="number" step="any" error={errors.longitude?.message} {...register("longitude", { valueAsNumber: true })} />
            <Field label="Raio permitido (m)" type="number" error={errors.radiusMeters?.message} {...register("radiusMeters", { valueAsNumber: true })} />
          </div>
          <h2>Administrador</h2>
          <div className="form-grid">
            <Field label="Nome completo" error={errors.name?.message} {...register("name")} />
            <Field label="E-mail" type="email" error={errors.email?.message} {...register("email")} />
            <Field label="Senha" type="password" error={errors.password?.message} {...register("password")} />
          </div>
          <Button loading={isSubmitting}>Concluir configuração</Button>
        </form>
      </Card>
    </div>
  );
}
