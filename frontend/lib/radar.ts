import { apiRequest } from "@/lib/api";

export type RadarEstado = "nueva" | "revisada" | "descartada" | "en_seguimiento";

export type RadarLicitacion = {
  id: number;
  numero_licitacion: string;
  objeto: string;
  categoria?: string | null;
  monto_estimado?: number | null;
  moneda?: string | null;
  fecha_apertura?: string | null;
  fecha_cierre?: string | null;
  fecha_apertura_iso?: string | null;
  fecha_cierre_iso?: string | null;
  link_sli?: string | null;
  es_prioritaria?: boolean | number | string | null;
  numero_enmienda?: string | null;
  enmienda_anterior?: string | null;
  enmienda_alerta?: boolean | number | string | null;
  fecha_enmienda_alerta?: string | null;
  fecha_descubierta?: string | null;
  fecha_ultimo_escaneo?: string | null;
  score_interes?: number | null;
  estado_radar?: RadarEstado | string | null;
  revisada_por?: string | null;
  notas?: string | null;
};

export type RadarResponse = {
  status: string;
  total: number;
  items: RadarLicitacion[];
};

export type RadarSchedulerStatus = {
  enabled?: boolean;
  interval_minutes?: number;
  running?: boolean;
  last_started?: string | null;
  last_finished?: string | null;
  last_result?: Record<string, unknown> | null;
  last_error?: string | null;
  next_run_at?: string | null;
};

export type RadarScanLog = {
  id: number;
  fecha?: string | null;
  total_encontradas?: number | string | null;
  nuevas?: number | string | null;
  errores?: string | null;
  paginas_recorridas?: number | string | null;
  total_detectadas_portal?: number | string | null;
  metodo?: string | null;
  escaneo_completo?: boolean | number | string | null;
};

export type RadarHistoricoMatch = {
  numero_licitacion?: string | null;
  mes?: string | null;
  anio?: number | string | null;
  codigo_acp?: string | null;
  codigo_match?: string | null;
  cantidad?: number | string | null;
  precio_proyelec?: number | string | null;
  precio_competencia?: number | string | null;
  adjudicada_a_proyelec?: string | null;
  analista_procura?: string | null;
  observaciones?: string | null;
  match_score?: number | string | null;
  match_reason?: string | null;
};

export type RadarHistoricoResponse = {
  status: string;
  radar: {
    numero_licitacion?: string | null;
    objeto?: string | null;
    categoria?: string | null;
  };
  keywords: string[];
  codigo_matches: string[];
  matches: RadarHistoricoMatch[];
  summary: {
    total: number;
    ganadas: number;
    precio_min?: number | string | null;
    precio_promedio?: number | string | null;
    mejor_match: number;
    requiere_revision_rfq?: boolean;
    nota?: string;
    recomendacion_supervisor?: {
      decision?: string;
      accion?: string;
      prioridad?: string;
      tone?: "ok" | "warn" | "info" | "neutral" | string;
      motivo?: string;
    };
  };
};

export type RadarQuery = {
  search?: string;
  soloNuevas?: boolean;
  soloHoy?: boolean;
  soloAlertas?: boolean;
  limit?: number;
};

function toQuery(params: RadarQuery) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.soloNuevas) query.set("solo_nuevas", "true");
  if (params.soloHoy) query.set("solo_hoy", "true");
  if (params.soloAlertas) query.set("solo_alertas", "true");
  if (params.limit) query.set("limit", String(params.limit));
  const value = query.toString();
  return value ? `?${value}` : "";
}

export function getRadarLicitaciones(params: RadarQuery = {}) {
  return apiRequest<RadarResponse>(`/radar/licitaciones${toQuery(params)}`);
}

export function runRadarScan() {
  return apiRequest<Record<string, unknown>>("/radar/scan-now", { method: "POST" });
}

export function getRadarScheduler() {
  return apiRequest<RadarSchedulerStatus>("/radar/scheduler");
}

export function getRadarEscaneos(limit = 8) {
  return apiRequest<{ status: string; escaneos: RadarScanLog[] }>(`/radar/escaneos?limit=${limit}`);
}

export function updateRadarEstado(id: number, estado: RadarEstado, usuario = "frontend", notas = "") {
  return apiRequest<{ status: string; id: number; estado: RadarEstado }>(`/radar/${id}/estado`, {
    method: "POST",
    body: JSON.stringify({ estado, usuario, notas })
  });
}

export function ackRadarEnmienda(id: number) {
  return apiRequest<{ status: string; id: number }>(`/radar/${id}/ack-enmienda`, {
    method: "POST"
  });
}

export function getRadarHistorico(id: number, limit = 12) {
  return apiRequest<RadarHistoricoResponse>(`/radar/${id}/historico?limit=${limit}`);
}

export function radarFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "si"].includes(text);
}
