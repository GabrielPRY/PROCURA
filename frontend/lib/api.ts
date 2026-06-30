const RAW_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";
const INTERNAL_TOKEN = process.env.NEXT_PUBLIC_INTERNAL_API_TOKEN ?? "default-dev-token";

function normalizeApiBaseUrl(value: string) {
  const clean = String(value || "").trim().replace(/\/+$/, "");
  if (!clean) return "http://127.0.0.1:8000/api/v1";
  if (clean.endsWith("/api/v1")) return clean;
  if (clean.endsWith("/api")) return `${clean}/v1`;
  return `${clean}/api/v1`;
}

const API_BASE_URL = normalizeApiBaseUrl(RAW_API_BASE_URL);

const SESSION_STORAGE_KEY = "procura_frontend_session";

function getStoredSessionToken() {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { session_token?: string };
    return String(parsed.session_token || "");
  } catch {
    return "";
  }
}


export type ApiRequestOptions = RequestInit & {
  token?: string;
  retries?: number;
  timeoutMs?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function friendlyApiError(status: number, detail: string) {
  if (detail) return detail;
  if (status === 408 || status === 504) return "La operacion tardo demasiado. Intenta de nuevo o reduce el alcance.";
  if (status === 429) return "El servicio esta recibiendo muchas solicitudes. Espera un momento e intenta otra vez.";
  if (status === 502 || status === 503) return "El servicio esta temporalmente ocupado o no disponible.";
  return `API error ${status}`;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("X-Internal-Token", options.token ?? INTERNAL_TOKEN);
  const sessionToken = getStoredSessionToken();
  if (sessionToken) headers.set("X-Procura-Session", sessionToken);

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = String(options.method || "GET").toUpperCase();
  const safeToRetry = method === "GET";
  const retries = options.retries ?? (safeToRetry ? 1 : 0);
  const timeoutMs = options.timeoutMs ?? (safeToRetry ? 25000 : 180000);
  const requestInit = { ...options };
  delete requestInit.retries;
  delete requestInit.timeoutMs;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...requestInit,
        headers,
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        let detail = "";
        try {
          const payload = JSON.parse(text) as { detail?: string };
          detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail || "");
        } catch {
          detail = text;
        }

        if (safeToRetry && attempt < retries && isRetryableStatus(response.status)) {
          await sleep(600 * (attempt + 1));
          continue;
        }

        throw new Error(friendlyApiError(response.status, detail));
      }

      return response.json() as Promise<T>;
    } catch (error) {
      lastError = error;
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      if (safeToRetry && attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      if (isAbort) throw new Error("La operacion tardo demasiado. Intenta de nuevo o reduce el alcance.");
      throw error;
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("No se pudo completar la solicitud.");
}

export type RadarSchedulerState = {
  enabled: boolean;
  interval_minutes: number;
  running: boolean;
  last_started: string | null;
  last_finished: string | null;
  last_result: unknown;
  last_error: string | null;
  next_run_at: string | null;
};

export function getRadarScheduler() {
  return apiRequest<RadarSchedulerState>("/radar/scheduler");
}
