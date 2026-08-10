"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Download, Printer, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Button, Card, Loading, Modal, PageHeader, PanelHeader } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { randomToken } from "@/lib/utils";
import type { Company } from "@/types";

export default function QRCodePage() {
  return <Protected role="admin"><QRCodeContent /></Protected>;
}

function QRCodeContent() {
  const { profile } = useAuth();
  const [company, setCompany] = useState<Company>();
  const [source, setSource] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    const snapshot = await getDoc(doc(db, "companies", profile.companyId));
    if (!snapshot.exists()) throw new Error("Empresa não encontrada.");
    const currentCompany = { id: snapshot.id, ...snapshot.data() } as Company;
    const qrSource = await QRCode.toDataURL(
      `P:${currentCompany.qrCodeId.toUpperCase()}`,
      {
        width: 640,
        margin: 4,
        color: { dark: "#0D0D0E", light: "#FFFFFF" },
        errorCorrectionLevel: "H",
      },
    );
    setCompany(currentCompany);
    setSource(qrSource);
  }, [profile]);

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível gerar o QR Code."));
  }, [load]);

  async function regenerate() {
    if (!company) return;
    try {
      setError("");
      await updateDoc(doc(db, "companies", company.id), {
        qrCodeId: randomToken(16),
        updatedAt: serverTimestamp(),
      });
      setConfirming(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar um novo código.");
    }
  }

  return (
    <AppShell title="QR Code">
      <PageHeader title="Código de validação" description="Disponibilize o código oficial usado nos registros de ponto da empresa." />
      {error && <Alert tone="error">{error}</Alert>}
      {!company && !error && <Loading />}
      {company && (
        <div className="qr-layout">
          <Card className="qr-card">
            <PanelHeader title={company.name} description="QR Code ativo para registro de ponto." />
            <div className="qr-paper">
              <Image src={source} width={640} height={640} unoptimized alt={`QR Code de ${company.name}`} />
              <b>REGISTRE SEU PONTO</b>
              <small>Aponte a câmera pelo sistema Ponto Uau</small>
            </div>
            <div className="qr-actions">
              <Button onClick={() => window.print()}><Printer />Imprimir</Button>
              <a className="button secondary" href={source} download={`qrcode-${company.name}.png`}><Download />Baixar PNG</a>
            </div>
          </Card>
          <Card>
            <span className="security-icon"><ShieldCheck /></span>
            <h3>Segurança do código</h3>
            <p className="muted">Gerar um novo código invalida imediatamente todas as cópias anteriores.</p>
            <Button className="danger-button" onClick={() => setConfirming(true)}><RefreshCw />Gerar novo código</Button>
          </Card>
        </div>
      )}
      <Modal open={confirming} title="Invalidar QR Code atual?" onClose={() => setConfirming(false)}>
        <p>Os códigos já impressos deixarão de funcionar.</p>
        <div className="modal-actions">
          <Button className="secondary" onClick={() => setConfirming(false)}>Cancelar</Button>
          <Button onClick={regenerate}>Gerar novo código</Button>
        </div>
      </Modal>
    </AppShell>
  );
}
