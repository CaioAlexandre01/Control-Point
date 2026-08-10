"use client";

import { Mail, ShieldCheck, UserRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Badge, Card, PageHeader, PanelHeader } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";

export default function Profile() {
  return <Protected role="employee"><ProfileContent /></Protected>;
}

function ProfileContent() {
  const { profile } = useAuth();
  const initials = profile?.name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <AppShell title="Meu perfil">
      <PageHeader title="Dados da conta" description="Confira suas informações de acesso e vínculo com a empresa." />
      <Card className="profile-panel">
        <PanelHeader title="Informações pessoais" description="Dados associados ao seu usuário." />
        <div className="profile-card">
          <div className="profile-avatar">{initials}</div>
          <div className="profile-identity">
            <h2>{profile?.name}</h2>
            <p><Mail />{profile?.email}</p>
            <div className="profile-meta"><span><UserRound />Funcionário</span><span><ShieldCheck />Acesso protegido</span></div>
          </div>
          <Badge tone={profile?.active ? "success" : "danger"}>{profile?.active ? "Conta ativa" : "Conta inativa"}</Badge>
        </div>
      </Card>
    </AppShell>
  );
}
