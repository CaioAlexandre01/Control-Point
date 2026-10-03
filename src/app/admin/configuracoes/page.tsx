"use client";

import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Building2, ClockArrowDown, DatabaseZap, MapPin, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Button, Card, Field, Loading, Modal, PageHeader, PanelHeader } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { resetSystem, type SystemResetMode } from "@/lib/admin-actions";
import { db } from "@/lib/firebase";
import type { Company } from "@/types";

export default function Settings() {
  return <Protected role="admin"><SettingsContent /></Protected>;
}

function SettingsContent() {
  const { profile, logout } = useAuth();
  const [company, setCompany] = useState<Company>();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetMode, setResetMode] = useState<SystemResetMode>();
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");

  useEffect(() => {
    if (!profile) return;
    getDoc(doc(db, "companies", profile.companyId))
      .then((snapshot) => {
        if (!snapshot.exists()) throw new Error("Empresa não encontrada.");
        setCompany({ id: snapshot.id, ...snapshot.data() } as Company);
      }).catch(() => setError("Não foi possível carregar a empresa. Atualize a página e tente novamente."));
  }, [profile]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!company) return;
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      await updateDoc(doc(db, "companies", company.id), {
        name: company.name,
        document: company.document,
        latitude: Number(company.latitude),
        longitude: Number(company.longitude),
        radiusMeters: Number(company.radiusMeters),
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
    } catch { setError("Não foi possível salvar as configurações. Tente novamente."); }
    finally { setSaving(false); }
  }

  function closeReset() {
    if (resetting) return;
    setResetOpen(false);
    setResetMode(undefined);
    setResetError("");
  }

  async function confirmReset() {
    if (!resetMode) return;
    try {
      setResetting(true);
      setResetError("");
      const result = await resetSystem(resetMode);
      if (resetMode === "all") {
        await logout().catch(() => undefined);
        window.location.replace("/setup");
        return;
      }
      setResetMessage(
        `${result.deleted.workdays} jornada${result.deleted.workdays === 1 ? "" : "s"} removida${result.deleted.workdays === 1 ? "" : "s"}. Os usuários foram mantidos.`,
      );
      setResetOpen(false);
      setResetMode(undefined);
      setResetError("");
    } catch (caught) {
      setResetError(caught instanceof Error ? caught.message : "Não foi possível resetar o sistema.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <AppShell title="Configurações">
      <PageHeader title="Preferências da empresa" description="Mantenha os dados de identificação e gerencie o ciclo de dados do sistema." />
      {error && <Alert tone="error">{error}</Alert>}
      {!company ? !error && <Loading /> : (
        <div className="stack">
          <Card className="settings-card">
            <PanelHeader
              title="Empresa e localização"
              description="Essas informações são usadas para validar as batidas da equipe."
              actions={<span className="panel-icon"><Building2 /></span>}
            />
            <form onSubmit={save}>
              {saved && <Alert tone="success">Configurações salvas.</Alert>}
              <div className="form-grid">
                <Field label="Nome da empresa" value={company.name} onChange={(event) => setCompany({ ...company, name: event.target.value })} />
                <Field label="Documento" value={company.document} onChange={(event) => setCompany({ ...company, document: event.target.value })} />
                <Field label="Latitude" type="number" step="any" required min={-90} max={90} value={company.latitude} onChange={(event) => setCompany({ ...company, latitude: Number(event.target.value) })} />
                <Field label="Longitude" type="number" step="any" required min={-180} max={180} value={company.longitude} onChange={(event) => setCompany({ ...company, longitude: Number(event.target.value) })} />
                <Field label="Raio permitido (m)" type="number" required min={10} max={1000} value={company.radiusMeters} onChange={(event) => setCompany({ ...company, radiusMeters: Number(event.target.value) })} />
              </div>
              <div className="form-footer"><span><MapPin />As batidas são permitidas dentro do raio configurado.</span><Button loading={saving}>Salvar alterações</Button></div>
            </form>
          </Card>

          <Card className="danger-zone">
            <div>
              <span className="danger-zone-icon"><RotateCcw /></span>
              <div><h2>Resetar sistema</h2><p>Apague registros de horas ou reinicie completamente a empresa.</p></div>
            </div>
            <Button className="danger-button" onClick={() => { setResetMessage(""); setResetOpen(true); }}>Resetar sistema</Button>
          </Card>
          {resetMessage && <Alert tone="success">{resetMessage}</Alert>}
        </div>
      )}

      <Modal open={resetOpen} title={resetMode ? "Confirmar reset" : "O que deseja resetar?"} onClose={closeReset}>
        {resetError && <Alert tone="error">{resetError}</Alert>}
        {!resetMode ? (
          <div className="reset-options">
            <button className="reset-option" onClick={() => setResetMode("hours")}>
              <span><ClockArrowDown /></span>
              <div><strong>Resetar horas</strong><p>Apaga jornadas e correções de ponto, mantendo empresa, usuários e convites.</p></div>
            </button>
            <button className="reset-option danger" onClick={() => setResetMode("all")}>
              <span><DatabaseZap /></span>
              <div><strong>Resetar tudo</strong><p>Apaga usuários, convites, jornadas, empresa e libera uma nova configuração inicial.</p></div>
            </button>
          </div>
        ) : (
          <div className="reset-confirmation">
            <Alert tone="error">
              {resetMode === "hours"
                ? "Todas as jornadas e correções de ponto serão apagadas permanentemente. Os usuários serão mantidos."
                : "Todos os usuários e dados serão apagados permanentemente. Você será desconectado e o sistema voltará para a configuração inicial."}
            </Alert>
            <p>Esta ação não pode ser desfeita.</p>
            <div className="modal-actions">
              <Button className="secondary" disabled={resetting} onClick={() => { setResetMode(undefined); setResetError(""); }}>Voltar</Button>
              <Button className="danger-button" loading={resetting} onClick={confirmReset}>
                {resetMode === "hours" ? "Resetar horas" : "Resetar tudo"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
