import { apiRequest } from "@/lib/api";
import type { RfqGeneralConditions, RfqItem } from "@/lib/rfq";

export type EvaluationResultValue = "Cumple" | "No cumple" | "Cumple parcialmente" | "No encontrado";

export type SupplierEvaluationRow = {
  renglon?: string | number;
  codigo_articulo?: string;
  descripcion?: string;
  resultado: EvaluationResultValue;
  confianza?: "Alta" | "Media" | "Baja" | string;
  requisito_acp?: string;
  oferta_proveedor?: string;
  evidencia?: string;
  documento_fuente?: string;
  pagina_fuente?: string | number;
  faltante_o_riesgo?: string;
  accion_sugerida?: "Aceptar" | "Pedir aclaración" | "Rechazar" | "Revisar manualmente" | string;
};

export const SUPPLIER_EVALUATION_DRAFT_PREFIX = "procura_supplier_evaluation_draft_";

export type SupplierEvaluationDraft = {
  supplier_name: string;
  item_indexes: number[];
  provider_url?: string;
  created_at: string;
};

export function saveSupplierEvaluationDraft(username: string, draft: SupplierEvaluationDraft) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${SUPPLIER_EVALUATION_DRAFT_PREFIX}${username}`, JSON.stringify(draft));
}

export function loadSupplierEvaluationDraft(username: string): SupplierEvaluationDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${SUPPLIER_EVALUATION_DRAFT_PREFIX}${username}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SupplierEvaluationDraft;
    if (!parsed.supplier_name || !Array.isArray(parsed.item_indexes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export type SupplierEvaluationResponse = {
  status: string;
  model?: string;
  resumen?: string;
  evaluaciones?: SupplierEvaluationRow[];
};

export function evaluateSupplierProposal({
  files,
  items,
  cg,
  geminiKey,
  username,
  role,
  supplierName,
  evaluationNotes
}: {
  files: File[];
  items: RfqItem[];
  cg: RfqGeneralConditions;
  geminiKey: string;
  username: string;
  role: string;
  supplierName?: string;
  evaluationNotes?: string;
}) {
  const formData = new FormData();
  files.forEach((file) => formData.append("archivos_propuesta", file));
  formData.append("items_json", JSON.stringify(items));
  formData.append("cg_json", JSON.stringify(cg));
  formData.append("gemini_key", geminiKey);
  formData.append("username", username);
  formData.append("role", role);
  formData.append("supplier_name", supplierName || "");
  formData.append("evaluation_notes", evaluationNotes || "");

  return apiRequest<SupplierEvaluationResponse>("/evaluar-propuesta", {
    method: "POST",
    body: formData
  });
}
