export const MAX_LOCATION_ACCURACY = 150;

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
};

export type DeviceType = "android" | "ios" | "other";

export interface CurrentLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

function isSecureAppOrigin() {
  if (typeof window === "undefined") return false;
  const { hostname, protocol } = window.location;
  const isLocalhost = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]";
  return window.isSecureContext && (protocol === "https:" || isLocalhost);
}

export function getDeviceType(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  maxTouchPoints = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
): DeviceType {
  if (/android/i.test(userAgent)) return "android";
  if (/iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return "ios";
  }
  return "other";
}

export async function requestCurrentLocation(): Promise<CurrentLocation> {
  if (!isSecureAppOrigin()) {
    throw new Error("A localização e a câmera só funcionam em uma conexão segura HTTPS.");
  }
  if (!navigator.geolocation) {
    throw new Error("Este navegador não suporta localização. Utilize uma versão atualizada do Chrome ou Safari.");
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, GEOLOCATION_OPTIONS);
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
}

export function validateLocationAccuracy(location: CurrentLocation) {
  const { latitude, longitude, accuracy } = location;
  if (
    !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || !Number.isFinite(accuracy)
    || accuracy < 0
  ) {
    throw new Error("A localização retornou coordenadas inválidas. Tente novamente.");
  }
  if (accuracy > MAX_LOCATION_ACCURACY) {
    throw new Error("A localização está muito imprecisa. Ative a localização precisa do celular e tente novamente.");
  }
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

export function getGeolocationErrorMessage(error: unknown, deviceType = getDeviceType()) {
  switch (errorCode(error)) {
    case 1:
      if (deviceType === "android") {
        return "A localização foi bloqueada para o navegador. Abra as configurações do navegador, acesse Permissões e permita a localização para este site.";
      }
      if (deviceType === "ios") {
        return "A localização foi bloqueada para o navegador. Abra Ajustes → Privacidade e Segurança → Serviços de Localização → Safari Websites → Durante o Uso. Também ative Localização Precisa.";
      }
      return "A localização foi bloqueada para o navegador. Abra as permissões do site nas configurações do navegador e permita o acesso à localização.";
    case 2:
      return "Não foi possível acessar sua localização. Verifique se os Serviços de Localização estão ativados no celular e tente novamente.";
    case 3:
      return "O GPS demorou para responder. Vá para um local com melhor sinal, mantenha a localização ativada e tente novamente.";
    default:
      return error instanceof Error
        ? error.message
        : "Não foi possível obter uma localização válida. Verifique as permissões e tente novamente.";
  }
}

export async function openDeviceCamera() {
  if (!isSecureAppOrigin()) {
    throw new Error("A localização e a câmera só funcionam em uma conexão segura HTTPS.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador não oferece suporte à câmera. Utilize uma versão atualizada do Chrome ou Safari.");
  }

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: {
        ideal: "environment",
      },
    },
  });
}

export function getCameraErrorMessage(error: unknown) {
  const candidate = error && typeof error === "object"
    ? error as { name?: unknown; message?: unknown }
    : undefined;
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  const message = typeof candidate?.message === "string"
    ? candidate.message
    : typeof error === "string" ? error : "";

  if (name === "NotAllowedError" || name === "SecurityError" || /notallowed|permission|denied|negado/i.test(message)) {
    return "Câmera bloqueada. Permita o acesso à câmera nas configurações do navegador.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "Nenhuma câmera compatível foi encontrada neste dispositivo.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "A câmera está em uso por outro aplicativo ou não pôde ser iniciada. Feche outros aplicativos e tente novamente.";
  }
  if (message) return message;
  return "Não foi possível iniciar a câmera. Verifique as permissões e tente novamente.";
}
