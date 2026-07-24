"use client";

import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { CheckCircle2, LoaderCircle, MapPin, QrCode, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Button, Card, Modal } from "@/components/ui";
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

type PunchField = "clockInAt" | "breakStartAt" | "breakEndAt" | "clockOutAt";

const punchLabels: Array<{ field: PunchField; label: string }> = [
  { field: "clockInAt", label: "Entrada" },
  { field: "breakStartAt", label: "Intervalo" },
  { field: "breakEndAt", label: "Retorno" },
  { field: "clockOutAt", label: "Saída" },
];

function punchTime(value?: Timestamp) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value.toDate());
}

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
  const [validatingQr, setValidatingQr] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const scanner = useRef<Html5Qrcode | null>(null);
  const validating = useRef(false);
  const nextActionRef = useRef<HTMLDivElement | null>(null);
  const next = nextEvent(workday);

  const load = useCallback(async () => {
    if (!profile) return;
    setWorkday(await getWorkday(profile.uid, profile.companyId));
  }, [profile]);

  const stopCamera = useCallback(async () => {
    const instance = scanner.current;
    scanner.current = null;
    validating.current = false;
    setScanning(false);
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
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { void stopCamera(); }, [stopCamera]);

  async function validateCode(rawValue: string) {
    if (validating.current) return;
    validating.current = true;
    setValidatingQr(true);
    setFeedback({ text: "QR Code reconhecido. Validando localização..." });
    console.info("[Ponto] QR reconhecido");

    try {
      scanner.current?.pause(true);
    } catch {
      // A leitura já pode estar pausada no momento do callback.
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const validationResult = await Promise.race([
        (async () => {
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
          console.info("[Ponto] Empresa carregada", { companyId: company.id });
          if (!company.active) throw new Error("Esta empresa está inativa.");
          if (company.qrCodeId !== qrCodeId) throw new Error("QR Code antigo ou inválido.");
          if (!navigator.geolocation) throw new Error("Este navegador não oferece localização.");

          console.info("[Ponto] GPS solicitado");
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15_000,
              maximumAge: 0,
            });
          });
          const { latitude, longitude, accuracy } = position.coords;
          console.info("[Ponto] GPS recebido", { latitude, longitude, accuracy });
          const distanceMeters = haversine(latitude, longitude, company.latitude, company.longitude);
          console.info("[Ponto] Distância calculada", { distanceMeters, accuracy, radiusMeters: company.radiusMeters });

          if (distanceMeters + accuracy > company.radiusMeters) {
            throw new Error(`Fora do local permitido. Distância: ${Math.round(distanceMeters)} m.`);
          }

          return {
            company,
            latitude,
            longitude,
            accuracy,
            distanceMeters,
            qrCodeId,
            validatedAt: Date.now(),
          } satisfies Validation;
        })(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("A validação excedeu 20 segundos. Tente novamente.")),
            20_000,
          );
        }),
      ]);

      setValidation(validationResult);
      setOfficialTime(undefined);
      await stopCamera();
      console.info("[Ponto] Validação concluída");
      setFeedback({ text: "QR Code e localização validados" });
      requestAnimationFrame(() => {
        nextActionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        setConfirming(true);
      });
    } catch (caught) {
      const geoError = caught as GeolocationPositionError;
      let text = caught instanceof Error ? caught.message : "Falha na validação.";
      if (typeof geoError?.code === "number") {
        if (geoError.code === geoError.PERMISSION_DENIED) text = "Localização bloqueada. Permita o acesso ao GPS.";
        if (geoError.code === geoError.POSITION_UNAVAILABLE) text = "Não foi possível determinar sua localização.";
        if (geoError.code === geoError.TIMEOUT) text = "A localização demorou demais. Tente novamente.";
      }
      await stopCamera();
      setValidation(undefined);
      setFeedback({ text, error: true });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      validating.current = false;
      setValidatingQr(false);
    }
  }

  async function startCamera() {
    try {
      await stopCamera();
      setFeedback(undefined);
      setOfficialTime(undefined);
      setValidatingQr(false);
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

  return (
    <AppShell title="Registrar ponto">
      <div className="employee-punch-page">
        <Card className="mobile-punch-card">
          <div className="mobile-punch-heading">
            <div className="scanner-head">
              <ScanLine />
              <div>
                <small>PRÓXIMA AÇÃO</small>
                <h2>{next ? actionLabels[next] : "Jornada concluída"}</h2>
              </div>
            </div>
            <span className={`work-state ${workday?.status ?? "not-started"}`}>
              {workday?.status === "on_break" ? "Intervalo" : workday?.status === "finished" ? "Concluído" : workday?.status === "working" ? "Trabalhando" : "Não iniciada"}
            </span>
          </div>

          {feedback && (
            <Alert tone={feedback.error ? "error" : "success"}>
              <span className="feedback-line">
                {!feedback.error && <CheckCircle2 size={18} />}
                {feedback.text}
                {officialTime && <small>Horário oficial</small>}
              </span>
            </Alert>
          )}

          <div className={`qr-reader-shell ${scanning ? "active" : ""}`}>
            <div id="qr-reader" />
            {validatingQr && (
              <div className="qr-validating" role="status" aria-live="polite">
                <LoaderCircle className="spin" />
                <strong>QR Code reconhecido</strong>
                <span>Validando empresa e localização...</span>
              </div>
            )}
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
          <Button className={validation ? "secondary camera-button" : "camera-button"} onClick={startCamera} disabled={scanning || validatingQr || !next}>
            {validatingQr ? <><LoaderCircle className="spin" />Validando...</> : scanning ? "Câmera ativa" : validation ? "Ler novamente" : "Abrir câmera"}
          </Button>
          <div ref={nextActionRef} className="mobile-next-action">
            <Button onClick={() => setConfirming(true)} disabled={!validation || !next}>
              {next ? `Confirmar ${actionLabels[next]}` : "Jornada concluída"}
            </Button>
          </div>
        </Card>

        <Card className="today-punches">
          <div className="today-punches-title">
            <h3>Batidas de hoje</h3>
            <span>{workday?.date ? workday.date.split("-").reverse().join("/") : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date())}</span>
          </div>
          <div className="punch-mini-table">
            {punchLabels.map(({ field, label }) => {
              const value = workday?.[field];
              return (
                <div key={field} className={value ? "registered" : ""}>
                  <span>{label}</span>
                  <strong>{punchTime(value)}</strong>
                  <small>{value ? "Registrado" : "Pendente"}</small>
                </div>
              );
            })}
          </div>
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
