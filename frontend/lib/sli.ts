import { apiRequest } from "@/lib/api";

export type SliActa = {
  disponible?: boolean;
  url?: string | null;
  resumen?: string;
  hallazgos?: string[];
  texto_muestra?: string;
  menciona_proyelec?: boolean;
  menciona_ep_international?: boolean;
  posible_adjudicacion_propia?: boolean;
  cumplimiento_tecnico?: "cumple" | "no_cumple" | "indeterminado";
  error?: string | null;
};

export type SliDetectedItem = {
  renglon?: string | null;
  codigo_articulo?: string | null;
  descripcion?: string | null;
  fuente?: string | null;
};

export type SliLookupResult = {
  rfq_id: string;
  url?: string;
  estatus?: string | null;
  descripcion?: string | null;
  fecha_cierre?: string | null;
  fecha_publicacion?: string | null;
  ultima_revision?: string | null;
  numero_enmienda?: string | null;
  agente_compras?: string | null;
  codigos_acp_detectados?: string[];
  renglones_detectados?: SliDetectedItem[];
  renglones_detectados_count?: number;
  requiere_revision_rfq?: boolean;
  nota_revision_rfq?: string;
  resumen_acta?: SliActa;
  error?: string | null;
};

export function consultarSli(rfqId: string) {
  return apiRequest<SliLookupResult>(`/consultar-sli/${encodeURIComponent(rfqId)}`, { timeoutMs: 70000, retries: 0 });
}
