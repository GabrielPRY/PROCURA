import { apiRequest } from "@/lib/api";

export type SourcingProvider = {
  renglon?: string;
  renglones_cubiertos?: string[];
  cobertura_renglones?: number;
  cobertura_detalle?: string;
  proveedor: string;
  pais_region?: string;
  tipo?: string;
  match_tecnico?: number;
  probabilidad_buen_precio?: string;
  riesgo?: string;
  decision?: string;
  evidencia?: string;
  que_validar?: string;
  url?: string;
};

export type SourcingSearchPlan = {
  renglon?: string;
  codigo_acp?: string;
  query_base?: string;
  queries?: string[];
  validar?: string[];
  criterio?: string;
};

export type SourcingItemPayload = {
  renglon?: string;
  codigo_acp?: string;
  descripcion?: string;
  busqueda_sugerida?: string;
  cantidad?: string;
  unidad?: string;
  marca_modelo?: string;
  acepta_equivalente?: boolean | null;
  requiere_propuesta_tecnica?: boolean;
  requiere_ficha_tecnica?: boolean;
  evidencia_tecnica?: string;
};

export function searchProviders(payload: {
  username: string;
  items: SourcingItemPayload[];
  custom_prompt: string;
  depth: string;
  target_count: number;
  sourcing_strategy?: "por_renglon" | "proveedor_integral";
}) {
  return apiRequest<{
    status: string;
    resumen: string;
    proveedores: SourcingProvider[];
    evidence_count: number;
    engine?: string;
    search_plan?: SourcingSearchPlan[];
  }>("/sourcing/providers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
