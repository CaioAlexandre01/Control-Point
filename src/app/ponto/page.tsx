"use client";

import { doc, getDoc, Timestamp } from "firebase/firestore";
import { CheckCircle2, ImageUp, LoaderCircle, MapPin, QrCode, ScanLine } from "lucide-react";
import QrScanner from "qr-scanner";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Protected } from "@/components/Protected";
import { Alert, Button, Card, Modal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { brTime, haversine } from "@/lib/utils";
import { getWorkday, nextEvent, registerPunch } from "@/lib/workday";
import type { Company, EventType, Validation, Workday } from "@/types";

// The native BarcodeDetector can stall indefinitely on some Android devices.
// qr-scanner 1.4.2 exposes this flag internally; forcing its worker gives every
// supported browser the same decoder and keeps the live and photo paths reliable.
(QrScanner as unknown as { _disableBarcodeDetector: boolean })._disableBarcodeDetector = true;

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

async function prepareQrImage(file: File): Promise<File | HTMLCanvasElement> {
  if (typeof createImageBitmap !== "function") return file;

  const bitmap = await createImageBitmap(file);
  try {
    const longestSide = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 1600 / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a foto.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export default function Ponto() {
  return <Protected role="employee"><PontoContent /></Protected>;
}

function PontoContent() {
  const { profile } = useAuth();
  const [workday, setWorkday] = useState<Workday>();
  const [validation, setValidation] = useState<Validation>();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean; info?: boolean }>();
  const [officialTime, setOfficialTime] = useState<Timestamp>();
  const [scanning, setScanning] = useState(false);
  const [validatingQr, setValidatingQr] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const scanner = useRef<QrScanner | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const validating = useRef(false);
  const scanWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decoderErrorShown = useRef(false);
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
    if (scanWatchdog.current) clearTimeout(scanWatchdog.current);
    scanWatchdog.current = null;
    setScanning(false);
    if (!instance) return;
    try {
      await instance.pause(true);
    } finally {
      instance.destroy();
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { void stopCamera(); }, [stopCamera]);

  async function validateCode(rawValue: string) {
    if (validating.current) return;
    validating.current = true;
    if (scanWatchdog.current) clearTimeout(scanWatchdog.current);
    scanWatchdog.current = null;
    setValidatingQr(true);
    setFeedback({ text: "QR Code reconhecido. Validando localização...", info: true });
    console.info("[Ponto] QR reconhecido");

    try {
      await scanner.current?.pause(true);
    } catch {
      // A leitura já pode estar pausada no momento do callback.
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const validationResult = await Promise.race([
        (async () => {
          const compactCode = /^P:([A-F0-9]{32})$/i.exec(rawValue.trim());
          let companyId = profile?.companyId ?? "";
          let qrCodeId = compactCode?.[1].toLowerCase() ?? "";

          if (!compactCode) {
            const url = new URL(rawValue);
            if (url.protocol !== "pontoqr:") throw new Error("QR Code inválido.");

            // Keep accepting the legacy URI so printed codes remain valid.
            const isLegacyCode = url.hostname === "empresa";
            companyId = isLegacyCode
              ? url.pathname.replace(/^\/+/, "")
              : profile?.companyId ?? "";
            qrCodeId = isLegacyCode
              ? url.searchParams.get("code") ?? ""
              : url.pathname.replace(/^\/+/, "");
          }

          if (!companyId || !qrCodeId) throw new Error("QR Code inválido.");

          if (!profile || companyId !== profile.companyId) {
            throw new Error("Este QR Code pertence a outra empresa.");
          }

          const companySnapshot = await getDoc(doc(db, "companies", companyId));
          if (!companySnapshot.exists()) throw new Error("Empresa não encontrada.");
          const company = { id: companySnapshot.id, ...companySnapshot.data() } as Company;
          console.info("[Ponto] Empresa carregada", { companyId: company.id });
          if (!company.active) throw new Error("Esta empresa está inativa.");
          if (company.qrCodeId.toLowerCase() !== qrCodeId.toLowerCase()) {
            throw new Error("QR Code antigo ou inválido.");
          }
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
            qrCodeId: company.qrCodeId,
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
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("A câmera só funciona em uma conexão HTTPS segura.");
      }
      const video = videoRef.current;
      if (!video) throw new Error("O leitor da câmera não está disponível.");

      decoderErrorShown.current = false;
      setScanning(true);
      const instance = new QrScanner(video, (result) => {
        void validateCode(result.data);
      }, {
        onDecodeError: (caught) => {
          if (caught === QrScanner.NO_QR_CODE_FOUND) return;
          console.error("[Ponto] Falha no detector de QR Code", caught);
          if (decoderErrorShown.current) return;
          decoderErrorShown.current = true;
          setFeedback({
            text: "A leitura contínua encontrou um problema. Use “Ler por foto” para continuar.",
            error: true,
          });
        },
        preferredCamera: "environment",
        maxScansPerSecond: 12,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        calculateScanRegion: (cameraVideo) => {
          const width = cameraVideo.videoWidth;
          const height = cameraVideo.videoHeight;
          const scale = Math.min(1, 960 / Math.max(width, height));
          return {
            x: 0,
            y: 0,
            width,
            height,
            downScaledWidth: Math.round(width * scale),
            downScaledHeight: Math.round(height * scale),
          };
        },
      });
      scanner.current = instance;
      await instance.start();
      if (scanner.current === instance) {
        scanWatchdog.current = setTimeout(() => {
          if (scanner.current !== instance || validating.current) return;
          setFeedback({
            text: "Ainda não reconheceu? Use “Ler por foto” para uma leitura imediata.",
            info: true,
          });
        }, 8_000);
      }
    } catch (caught) {
      await stopCamera();
      const message = caught instanceof Error ? caught.message : String(caught);
      console.error("[Ponto] Falha ao iniciar câmera", caught);
      setFeedback({
        text: message.includes("HTTPS")
          ? message
          : /notallowed|permission|denied|negado/i.test(message)
            ? "Câmera bloqueada. Permita o acesso à câmera nas configurações do navegador."
            : `Não foi possível iniciar a câmera: ${message}`,
        error: true,
      });
    }
  }

  async function scanQrImage(file: File) {
    try {
      await stopCamera();
      setFeedback({ text: "Lendo a foto do QR Code...", info: true });
      setOfficialTime(undefined);
      const image = await prepareQrImage(file);
      const result = await QrScanner.scanImage(image, {
        returnDetailedScanResult: true,
        alsoTryWithoutScanRegion: true,
      });
      await validateCode(result.data);
    } catch (caught) {
      setValidatingQr(false);
      setFeedback({
        text: caught instanceof Error && caught.message !== QrScanner.NO_QR_CODE_FOUND
          ? `Não foi possível ler a foto: ${caught.message}`
          : "Nenhum QR Code foi encontrado na foto. Enquadre o código inteiro e tente novamente.",
        error: true,
      });
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
            <Alert tone={feedback.error ? "error" : feedback.info ? "info" : "success"}>
              <span className="feedback-line">
                {!feedback.error && !feedback.info && <CheckCircle2 size={18} />}
                {feedback.text}
                {officialTime && <small>Horário oficial</small>}
              </span>
            </Alert>
          )}

          <div className={`qr-reader-shell ${scanning ? "active" : ""}`}>
            <video ref={videoRef} className="qr-video" muted playsInline />
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
          <div className="qr-reader-actions">
            <Button className={validation ? "secondary camera-button" : "camera-button"} onClick={startCamera} disabled={scanning || validatingQr || !next}>
              {validatingQr ? <><LoaderCircle className="spin" />Validando...</> : scanning ? "Câmera ativa" : validation ? "Ler novamente" : "Abrir câmera"}
            </Button>
            <Button
              className="secondary photo-button"
              disabled={validatingQr || !next}
              onClick={() => {
                void stopCamera();
                fileInputRef.current?.click();
              }}
            >
              <ImageUp />Ler por foto
            </Button>
            <input
              ref={fileInputRef}
              className="qr-file-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void scanQrImage(file);
              }}
            />
          </div>
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
