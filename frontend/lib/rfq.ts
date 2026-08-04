import { apiRequest } from "@/lib/api";

export type UserConfigResponse = {
  status: string;
  email_user?: string;
  gemini_key?: string;
  has_gemini_key?: boolean;
  gemini_source?: "usuario" | "admin_global" | "sin_configurar" | string;
  tavily_key?: string;
  has_tavily_key?: boolean;
  tavily_source?: "usuario" | "admin_global" | "sin_configurar" | string;
};

export type RfqGeneralConditions = Record<string, unknown>;

export type RfqItem = {
  renglon?: string | number | null;
  codigo_articulo?: string | null;
  descripcion?: string | null;
  ficha_tecnica_completa?: string | null;
  cantidad?: string | number | null;
  unidad_de_medida?: string | null;
  unidad?: string | null;
  termino_de_busqueda_corto?: string | null;
  requiere_propuesta_tecnica?: boolean | string | number | null;
  requiere_ficha_tecnica?: boolean | string | number | null;
  marca_modelo_requerido?: string | null;
  acepta_equivalente?: boolean | string | number | null;
  posible_obsolescencia?: boolean | string | number | null;
  evidencia_tecnica?: string | null;
};

export type RfqAnalysisResponse = {
  condiciones_generales?: RfqGeneralConditions;
  items?: RfqItem[];
  [key: string]: unknown;
};

const RFQ_SESSION_PREFIX = "procura_last_rfq_";
const RFQ_ACTIVE_CONTEXT_PREFIX = "procura_active_rfq_context_";
const USER_CONFIG_TTL_MS = 5 * 60_000;
const userConfigCache = new Map<string, { expiresAt: number; promise: Promise<UserConfigResponse> }>();

export type ActiveRfqItemContext = {
  created_at: string;
  target_module?: string;
  licitacion?: string;
  item_index: number;
  renglon?: string;
  codigo_acp?: string;
  descripcion?: string;
  cantidad?: string;
  unidad?: string;
  requiere_propuesta_tecnica?: boolean;
  requiere_ficha_tecnica?: boolean;
  acepta_equivalente?: boolean | null;
  marca_modelo_requerido?: string;
  evidencia_tecnica?: string;
  riesgo_tecnico_global?: string;
  propuesta_tecnica_requerida?: string;
  presencia_local?: string;
  empresa_sugerida?: string;
};

export function saveLastRfq(username: string, result: RfqAnalysisResponse) {
  window.localStorage.setItem(`${RFQ_SESSION_PREFIX}${username}`, JSON.stringify(result));
}

export function loadLastRfq(username: string): RfqAnalysisResponse | null {
  try {
    const raw = window.localStorage.getItem(`${RFQ_SESSION_PREFIX}${username}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RfqAnalysisResponse;
    if (!Array.isArray(parsed.items) || !parsed.items.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveRfqContext(username: string, context: ActiveRfqItemContext) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${RFQ_ACTIVE_CONTEXT_PREFIX}${username}`, JSON.stringify(context));
}

export function loadActiveRfqContext(username: string): ActiveRfqItemContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${RFQ_ACTIVE_CONTEXT_PREFIX}${username}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveRfqItemContext;
    if (!Number.isFinite(Number(parsed.item_index))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getUserConfig(username: string) {
  const key = username.trim().toLowerCase();
  const now = Date.now();
  const cached = userConfigCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = apiRequest<UserConfigResponse>(`/configuracion/${encodeURIComponent(username)}`, {
    retries: 1,
    timeoutMs: 20000
  }).catch((error) => {
    userConfigCache.delete(key);
    throw error;
  });

  userConfigCache.set(key, { expiresAt: now + USER_CONFIG_TTL_MS, promise });
  return promise;
}

export function analyzeRfq({
  files,
  geminiKey,
  username,
  role
}: {
  files: File[];
  geminiKey: string;
  username: string;
  role: string;
}) {
  const formData = new FormData();
  files.forEach((file) => formData.append("archivos_pdf", file));
  formData.append("gemini_key", geminiKey);
  formData.append("username", username);
  formData.append("role", role);

  return apiRequest<RfqAnalysisResponse>("/analizar-pliego", {
    method: "POST",
    body: formData
  });
}

export function asBool(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "si"].includes(text);
}

export function asOptionalBool(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "si"].includes(text)) return true;
  if (["false", "0", "no"].includes(text)) return false;
  return null;
}

export function cleanValue(value: unknown, fallback = "No especificado") {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "nan" || text.toLowerCase() === "none") return fallback;
  return text;
}
