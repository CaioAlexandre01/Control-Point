"use client";

import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { CheckCircle2, Clock3, MapPin, QrCode, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Badge, Button, Card, Modal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { brTime, haversine } from "@/lib/utils";
import { getWorkday, nextEvent, registerPunch } from "@/lib/workday";
import type { Company, EventType, Validation, Workday } from "@/types";

const actionLabels: Record<EventType, string> = {
  clock_in: "entrada",
  break_start: "início do intervalo",
  break_end: "fim do intervalo",
  clock_out: "saída",
};

const stateLabels = {
  working: "Trabalhando",
  on_break: "Em intervalo",
  finished: "Jornada encerrada",
};

export default function Ponto() {
  return <Protected role="employee"><PontoContent /></Protected>;
}

function PontoContent() {
  const { profile } = useAuth();
  const [workday, setWorkday] = useState<Workday>();
  const [validation, setValidation] = useState<Validation>();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [officialTime, setOfficialTime] = useState<Timestamp>();
  const [scanning, setScanning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const scanner = useRef<Html5Qrcode | null>(null);
  const validating = useRef(false);
  const next = nextEvent(workday);

  const load = useCallback(async () => {
    if (!profile) return;
    setWorkday(await getWorkday(profile.uid, profile.companyId));
  }, [profile]);

  const stopCamera = useCallback(async () => {
    const instance = scanner.current;
    scanner.current = null;
    validating.current = false;
    if (!instance) return;
    try {
      const state = instance.getState();
      if (
        state === Html5QrcodeScannerState.SCANNING ||
        state === Html5QrcodeScannerState.PAUSED
      ) {
        await instance.stop();
      }
      instance.clear();
    } catch {
      // The camera may already have been released by the browser.
    }
    setScanning(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { void stopCamera(); }, [stopCamera]);

  async function validateCode(rawValue: string) {
    if (validating.current) return;
    validating.current = true;
    try {
      const url = new URL(rawValue);
      const companyId = url.pathname.replace(/^\/+/, "");
      const qrCodeId = url.searchParams.get("code");
      if (url.protocol !== "pontoqr:" || url.hostname !== "empresa" || !companyId || !qrCodeId) {
        throw new Error("QR Code inválido.");
      }
      if (!profile || companyId !== profile.companyId) {
        throw new Error("Este QR Code pertence a outra empresa.");
      }

      const companySnapshot = await getDoc(doc(db, "companies", companyId));
      if (!companySnapshot.exists()) throw new Error("Empresa não encontrada.");
      const company = { id: companySnapshot.id, ...companySnapshot.data() } as Company;
      if (!company.active) throw new Error("Esta empresa está inativa.");
      if (company.qrCodeId !== qrCodeId) throw new Error("QR Code antigo ou inválido.");
      if (!navigator.geolocation) throw new Error("Este navegador não oferece localização.");

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 0,
        });
      });
      const { latitude, longitude, accuracy } = position.coords;
      const distanceMeters = haversine(latitude, longitude, company.latitude, company.longitude);

      // The uncertainty is included to avoid accepting a location whose
      // accuracy circle extends beyond the configured perimeter.
      if (distanceMeters + accuracy > company.radiusMeters) {
        throw new Error(`Fora do local permitido. Distância: ${Math.round(distanceMeters)} m.`);
      }

      setValidation({
        company,
        latitude,
        longitude,
        accuracy,
        distanceMeters,
        qrCodeId,
        validatedAt: Date.now(),
      });
      setOfficialTime(undefined);
      setFeedback({ text: "QR Code e localização validados." });
      await stopCamera();
    } catch (caught) {
      const geoError = caught as GeolocationPositionError;
      let text = caught instanceof Error ? caught.message : "Falha na validação.";
      if (typeof geoError?.code === "number") {
        if (geoError.code === geoError.PERMISSION_DENIED) text = "Localização bloqueada. Permita o acesso ao GPS.";
        if (geoError.code === geoError.POSITION_UNAVAILABLE) text = "Não foi possível determinar sua localização.";
        if (geoError.code === geoError.TIMEOUT) text = "A localização demorou demais. Tente novamente.";
      }
      setValidation(undefined);
      setFeedback({ text, error: true });
      validating.current = false;
    }
  }

  async function startCamera() {
    try {
      await stopCamera();
      setFeedback(undefined);
      setOfficialTime(undefined);
      setScanning(true);
      const instance = new Html5Qrcode("qr-reader");
      scanner.current = instance;
      await instance.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => { void validateCode(decoded); },
        () => undefined,
      );
    } catch {
      await stopCamera();
      setFeedback({ text: "Câmera bloqueada ou indisponível. Verifique a permissão.", error: true });
    }
  }

  async function punch() {
    if (!profile || !validation || !next) return;
    try {
      setSaving(true);
      const result = await registerPunch(profile.uid, profile.companyId, next, validation);
      setWorkday(result.workday);
      setValidation(undefined);
      setConfirming(false);
      setOfficialTime(result.officialTimestamp);
      setFeedback({
        text: result.officialTimestamp
          ? `Registro confirmado às ${brTime(result.officialTimestamp.toDate())}.`
          : "Registro confirmado com o horário oficial.",
      });
    } catch (caught) {
      setValidation(undefined);
      setConfirming(false);
      setFeedback({
        text: caught instanceof Error ? caught.message : "Não foi possível registrar.",
        error: true,
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  const currentState = workday?.status
    ? stateLabels[workday.status]
    : "Jornada não iniciada";

  return (
    <AppShell title="Registrar ponto">
      <div className="ponto-focus">
        <Card className="current-state">
          <span className="eyebrow">Estado atual</span>
          <div>
            <span className="state-icon"><Clock3 /></span>
            <div><h2>{currentState}</h2><p>{next ? `Próxima ação: ${actionLabels[next]}` : "Todos os registros do dia foram concluídos."}</p></div>
            <Badge tone={workday?.status === "finished" ? "success" : workday?.status === "on_break" ? "warning" : "neutral"}>
              {workday?.status === "finished" ? "Concluído" : "Hoje"}
            </Badge>
          </div>
        </Card>

        {feedback && (
          <Alert tone={feedback.error ? "error" : "success"}>
            <span className="feedback-line">
              {!feedback.error && <CheckCircle2 size={18} />}
              {feedback.text}
              {officialTime && <small>Horário oficial do Firestore</small>}
            </span>
          </Alert>
        )}

        <Card className="scanner-card">
          <div className="scanner-head">
            <ScanLine />
            <div><h3>Leitura do QR Code</h3><p>Leia novamente antes de cada registro.</p></div>
          </div>
          <div className={`qr-reader-shell ${scanning ? "active" : ""}`}>
            <div id="qr-reader" />
            {!scanning && (
              <div className="qr-placeholder">
                <QrCode size={58} />
                <p>Aponte a câmera para o código da empresa</p>
              </div>
            )}
          </div>
          <div className="scan-status">
            <span><QrCode />{validation ? "QR válido" : "QR pendente"}</span>
            <span><MapPin />{validation ? `${Math.round(validation.distanceMeters)} m · precisão ${Math.round(validation.accuracy)} m` : "Localização pendente"}</span>
          </div>
          <Button onClick={startCamera} disabled={scanning || !next}>
            {scanning ? "Câmera ativa" : validation ? "Ler novamente" : "Abrir câmera"}
          </Button>
        </Card>

        <Card className="next-action">
          <div><span className="eyebrow">Próxima ação</span><h2>{next ? actionLabels[next] : "Jornada concluída"}</h2></div>
          <Button onClick={() => setConfirming(true)} disabled={!validation || !next}>
            {next ? `Confirmar ${actionLabels[next]}` : "Sem ações disponíveis"}
          </Button>
        </Card>
      </div>

      <Modal
        open={confirming}
        title={next ? `Confirmar ${actionLabels[next]}?` : "Confirmar registro?"}
        onClose={() => setConfirming(false)}
      >
        <div className="confirm-summary">
          <span><MapPin />{validation?.company.name}</span>
          <span><QrCode />QR Code e localização válidos</span>
        </div>
        <div className="modal-actions">
          <Button className="secondary" onClick={() => setConfirming(false)}>Cancelar</Button>
          <Button loading={saving} onClick={punch}>Confirmar</Button>
        </div>
      </Modal>
    </AppShell>
  );
}
