import { apiRequest } from "@/lib/api";

export const COMPANY_AUDIT_DRAFT_KEY = "procura_company_audit_draft";

export type CompanyAuditEvidence = {
  titulo?: string;
  detalle?: string;
  url?: string;
};

export type CompanyAuditDraft = {
  company_name?: string;
  website?: string;
  country?: string;
  product_context?: string;
  notes?: string;
  source?: "proveedores" | "manual";
  created_at?: string;
};

export type CompanyTechnicalAudit = {
  normalized_url?: string;
  domain?: string;
  rdap?: {
    available?: boolean;
    registrar?: string;
    created_at?: string | null;
    expires_at?: string | null;
    domain_age_days?: number | null;
    expires_in_days?: number | null;
    nameservers?: string[];
    error?: string;
  };
  ssl?: {
    available?: boolean;
    valid?: boolean;
    issuer?: string;
    subject?: string;
    expires_at?: string | null;
    expires_in_days?: number | null;
    error?: string;
  };
  website?: {
    available?: boolean;
    final_url?: string;
    status_code?: number | null;
    https?: boolean;
    title?: string;
    has_contact_page?: boolean;
    has_about_page?: boolean;
    has_privacy_or_terms?: boolean;
    emails?: string[];
    free_email_detected?: boolean;
    phones_detected?: number;
    error?: string;
  };
  scorecard?: {
    score?: number;
    riesgo_tecnico?: string;
    decision_tecnica?: string;
    positivos?: string[];
    alertas?: string[];
  };
};

export type CompanyAuditResponse = {
  status: string;
  audit_id?: number;
  resumen?: string;
  riesgo?: "Bajo" | "Medio" | "Alto" | string;
  decision?: "Avanzar" | "Avanzar con cautela" | "Pedir validacion" | "Descartar" | string;
  confianza?: "Alta" | "Media" | "Baja" | string;
  score_final?: number;
  riesgo_tecnico?: string;
  decision_tecnica?: string;
  empresa?: string;
  website?: string;
  pais_region?: string;
  senal_positiva?: string[];
  senal_alerta?: string[];
  validaciones_pendientes?: string[];
  preguntas_al_proveedor?: string[];
  evidencia?: CompanyAuditEvidence[];
  recomendacion_operativa?: string;
  auditoria_tecnica?: CompanyTechnicalAudit;
  engine?: string;
  evidence_count?: number;
};

export type CompanyAuditListItem = {
  id: number;
  created_at?: string;
  username?: string;
  company_name?: string;
  website?: string;
  domain?: string;
  country?: string;
  score_final?: number;
  riesgo?: string;
  decision?: string;
  confianza?: string;
  riesgo_tecnico?: string;
  decision_tecnica?: string;
  engine?: string;
  evidence_count?: number;
};

export function auditCompany(payload: {
  username: string;
  company_name: string;
  website?: string;
  country?: string;
  product_context?: string;
  notes?: string;
}) {
  return apiRequest<CompanyAuditResponse>("/sourcing/audit-company", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listCompanyAudits(payload: { search?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (payload.search) params.set("search", payload.search);
  if (payload.limit) params.set("limit", String(payload.limit));
  const query = params.toString();
  return apiRequest<{ status: string; audits: CompanyAuditListItem[] }>(`/sourcing/company-audits${query ? `?${query}` : ""}`);
}
