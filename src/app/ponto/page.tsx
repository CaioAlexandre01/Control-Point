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
import {
  getCameraErrorMessage,
  getGeolocationErrorMessage,
  openDeviceCamera,
  requestCurrentLocation,
  validateLocationAccuracy,
  type CurrentLocation,
} from "@/lib/point-permissions";
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

interface RequiredLocationValidation extends CurrentLocation {
  company: Company;
  distanceMeters: number;
  validatedAt: number;
}

function validateAllowedRadius(location: CurrentLocation, company: Company) {
  const distanceMeters = haversine(
    location.latitude,
    location.longitude,
    company.latitude,
    company.longitude,
  );

  if (distanceMeters + location.accuracy > company.radiusMeters) {
    throw new Error(
      `Você está fora da área permitida.\n\nDistância atual: ${Math.round(distanceMeters)} metros\nLimite permitido: ${Math.round(company.radiusMeters)} metros`,
    );
  }

  return distanceMeters;
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
  const [requiredLocation, setRequiredLocation] = useState<RequiredLocationValidation>();
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [isOpeningCamera, setIsOpeningCamera] = useState(false);
  const [pendingAction, setPendingAction] = useState<"camera" | "photo">();
  const [locationError, setLocationError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const scanner = useRef<QrScanner | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requiredLocationRef = useRef<RequiredLocationValidation | null>(null);
  const permissionFlowActive = useRef(false);
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
    const stream = cameraStream.current;
    scanner.current = null;
    cameraStream.current = null;
    validating.current = false;
    if (scanWatchdog.current) clearTimeout(scanWatchdog.current);
    scanWatchdog.current = null;
    setScanning(false);
    try {
      if (instance) await instance.pause(true);
    } finally {
      instance?.destroy();
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null;
    }
  }, []);

  const clearRequiredLocation = useCallback(() => {
    requiredLocationRef.current = null;
    setRequiredLocation(undefined);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { void stopCamera(); }, [stopCamera]);

  async function prepareRequiredLocation() {
    setIsRequestingLocation(true);
    setLocationError(null);
    setCameraError(null);
    setValidation(undefined);
    clearRequiredLocation();
    setFeedback({ text: "Verificando localização...", info: true });

    try {
      // This is intentionally the first asynchronous browser API called by the click handlers.
      const location = await requestCurrentLocation();
      validateLocationAccuracy(location);
      const validatedAt = Date.now();

      if (!profile) throw new Error("Seu perfil não está disponível. Entre novamente no sistema.");
      const companySnapshot = await getDoc(doc(db, "companies", profile.companyId));
      if (!companySnapshot.exists()) throw new Error("Empresa não encontrada.");
      const company = { id: companySnapshot.id, ...companySnapshot.data() } as Company;
      if (!company.active) throw new Error("Esta empresa está inativa.");
      if (
        !Number.isFinite(company.latitude)
        || !Number.isFinite(company.longitude)
        || !Number.isFinite(company.radiusMeters)
        || company.radiusMeters <= 0
      ) {
        throw new Error("A localização da empresa não está configurada corretamente.");
      }

      const distanceMeters = validateAllowedRadius(location, company);
      const result: RequiredLocationValidation = {
        ...location,
        company,
        distanceMeters,
        validatedAt,
      };
      requiredLocationRef.current = result;
      setRequiredLocation(result);
      return result;
    } catch (caught) {
      clearRequiredLocation();
      setLocationError(getGeolocationErrorMessage(caught));
      throw caught;
    } finally {
      setIsRequestingLocation(false);
    }
  }

  async function validateCode(rawValue: string) {
    const locationValidation = requiredLocationRef.current;
    if (!locationValidation) {
      await stopCamera();
      setLocationError("Obtenha uma localização válida antes de abrir a câmera e ler o QR Code.");
      return;
    }
    if (validating.current) return;
    validating.current = true;
    if (scanWatchdog.current) clearTimeout(scanWatchdog.current);
    scanWatchdog.current = null;
    setValidatingQr(true);
    setFeedback({ text: "QR Code reconhecido. Validando empresa...", info: true });
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

          const { company } = locationValidation;
          if (company.id !== companyId) throw new Error("Este QR Code pertence a outra empresa.");
          if (company.qrCodeId.toLowerCase() !== qrCodeId.toLowerCase()) {
            throw new Error("QR Code antigo ou inválido.");
          }
          if (Date.now() - locationValidation.validatedAt > 120_000) {
            throw new Error("A validação da localização expirou. Tente novamente.");
          }

          return {
            company,
            latitude: locationValidation.latitude,
            longitude: locationValidation.longitude,
            accuracy: locationValidation.accuracy,
            distanceMeters: locationValidation.distanceMeters,
            qrCodeId: company.qrCodeId,
            validatedAt: locationValidation.validatedAt,
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
      await stopCamera();
      clearRequiredLocation();
      setValidation(undefined);
      setFeedback({
        text: caught instanceof Error ? caught.message : "Falha na validação do QR Code.",
        error: true,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      validating.current = false;
      setValidatingQr(false);
    }
  }

  async function startQrScanner() {
    const video = videoRef.current;
    if (!video) throw new Error("O leitor da câmera não está disponível.");

    const stream = await openDeviceCamera();
    cameraStream.current = stream;
    video.srcObject = stream;
    decoderErrorShown.current = false;

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
    setScanning(true);
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
  }

  async function handleOpenCamera() {
    if (!next || scanning || validatingQr || permissionFlowActive.current) return;
    permissionFlowActive.current = true;
    setPendingAction("camera");
    setOfficialTime(undefined);
    setValidatingQr(false);

    let locationIsValid = false;
    try {
      await prepareRequiredLocation();
      locationIsValid = true;
      setIsOpeningCamera(true);
      setFeedback({ text: "Abrindo câmera...", info: true });
      await stopCamera();
      await startQrScanner();
      setFeedback({ text: "Localização validada. Câmera liberada." });
    } catch (caught) {
      await stopCamera();
      setFeedback(undefined);
      if (locationIsValid) {
        clearRequiredLocation();
        console.error("[Ponto] Falha ao iniciar câmera", caught);
        setCameraError(getCameraErrorMessage(caught));
      }
    } finally {
      setIsOpeningCamera(false);
      setPendingAction(undefined);
      permissionFlowActive.current = false;
    }
  }

  async function handleReadPhoto() {
    if (!next || validatingQr || permissionFlowActive.current) return;

    const currentLocation = requiredLocationRef.current;
    if (currentLocation && Date.now() - currentLocation.validatedAt <= 120_000 && !validation) {
      setCameraError(null);
      setLocationError(null);
      void stopCamera().catch((caught) => {
        console.error("[Ponto] Falha ao encerrar câmera antes da foto", caught);
      });
      const input = fileInputRef.current;
      if (!input) {
        clearRequiredLocation();
        setCameraError("O leitor de foto não está disponível.");
        return;
      }
      setFeedback({ text: "Localização validada. Selecione ou tire uma foto do QR Code." });
      input.click();
      return;
    }

    permissionFlowActive.current = true;
    setPendingAction("photo");
    setOfficialTime(undefined);
    setValidatingQr(false);

    try {
      await prepareRequiredLocation();
      await stopCamera();
      setFeedback({ text: "Localização validada. Toque novamente em “Abrir foto” para continuar." });
    } catch {
      await stopCamera();
      setFeedback(undefined);
    } finally {
      setPendingAction(undefined);
      permissionFlowActive.current = false;
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
      clearRequiredLocation();
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
      clearRequiredLocation();
      setConfirming(false);
      setOfficialTime(result.officialTimestamp);
      setFeedback({
        text: result.officialTimestamp
          ? `Registro confirmado às ${brTime(result.officialTimestamp.toDate())}.`
          : "Registro confirmado com o horário oficial.",
      });
    } catch (caught) {
      setValidation(undefined);
      clearRequiredLocation();
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

  const visibleLocation = validation ?? requiredLocation;
  const permissionFlowBusy = isRequestingLocation || isOpeningCamera;

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
          {locationError && (
            <Alert tone="error">
              <span className="permission-error" role="alert">{locationError}</span>
            </Alert>
          )}
          {cameraError && (
            <Alert tone="error">
              <span className="permission-error" role="alert">{cameraError}</span>
            </Alert>
          )}

          <div className={`qr-reader-shell ${scanning ? "active" : ""}`}>
            <video ref={videoRef} className="qr-video" muted playsInline />
            {validatingQr && (
              <div className="qr-validating" role="status" aria-live="polite">
                <LoaderCircle className="spin" />
                <strong>QR Code reconhecido</strong>
                <span>Validando empresa e QR Code...</span>
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
            <span><MapPin />{visibleLocation ? `${Math.round(visibleLocation.distanceMeters)} m · precisão ${Math.round(visibleLocation.accuracy)} m` : "Localização pendente"}</span>
          </div>
          <div className="qr-reader-actions">
            <Button
              className={validation ? "secondary camera-button" : "camera-button"}
              onClick={handleOpenCamera}
              disabled={scanning || validatingQr || permissionFlowBusy || !next}
            >
              {isRequestingLocation && pendingAction === "camera"
                ? <><LoaderCircle className="spin" />Verificando localização...</>
                : isOpeningCamera && pendingAction === "camera"
                  ? <><LoaderCircle className="spin" />Abrindo câmera...</>
                  : validatingQr
                    ? <><LoaderCircle className="spin" />Validando...</>
                    : scanning ? "Câmera ativa" : validation ? "Ler novamente" : "Abrir câmera"}
            </Button>
            <Button
              className="secondary photo-button"
              disabled={validatingQr || permissionFlowBusy || !next}
              onClick={handleReadPhoto}
            >
              {isRequestingLocation && pendingAction === "photo"
                ? <><LoaderCircle className="spin" />Verificando localização...</>
                : <><ImageUp />{requiredLocation && !validation ? "Abrir foto" : "Ler por foto"}</>}
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
