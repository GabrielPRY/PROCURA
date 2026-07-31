"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  GitCompareArrows,
  Globe2,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  SearchCheck,
  Scale,
  ShieldAlert,
  ShieldCheck
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  auditCompany,
  COMPANY_AUDIT_DRAFT_KEY,
  listCompanyAudits,
  type CompanyAuditDraft,
  type CompanyAuditListItem,
  type CompanyAuditResponse
} from "@/lib/company-audit";
import { type AuthUser } from "@/lib/auth";
import { cleanValue, getUserConfig } from "@/lib/rfq";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type View = "prepare" | "result" | "history";
type BadgeTone = "neutral" | "info" | "ok" | "warn" | "danger";

function riskTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("bajo")) return "ok";
  if (normalized.includes("alto")) return "danger";
  return "warn";
}

function decisionTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("descartar")) return "danger";
  if (normalized.includes("avanzar") && !normalized.includes("cautela")) return "ok";
  if (normalized.includes("validacion") || normalized.includes("validación")) return "danger";
  return "warn";
}

function confidenceTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("alta")) return "ok";
  if (normalized.includes("baja")) return "danger";
  return "warn";
}

function verificationTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("inconsistente") || normalized.includes("coincidencia confirm") || normalized.includes("hallazgos oficiales")) return "danger";
  if (normalized.includes("posible") || normalized.includes("parcial") || normalized.includes("no verific") || normalized.includes("no confirmado")) return "warn";
  if (normalized.includes("verificada") || normalized.includes("coherente") || normalized.includes("sin coincid") || normalized.includes("sin hallazgos")) return "ok";
  return "neutral";
}

function formatAuditDate(value?: string) {
  if (!value) return "N/D";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function listValue(items?: string[]) {
  return Array.isArray(items) ? [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))] : [];
}

function yesNo(value?: boolean) {
  if (value === true) return "Sí";
  if (value === false) return "No";
  return "N/D";
}

function daysLabel(value?: number | null) {
  if (typeof value !== "number") return "N/D";
  if (value >= 730) return `${Math.floor(value / 365)} años`;
  return `${value} días`;
}

function scoreLabel(score?: number) {
  if (typeof score !== "number") return "Sin puntuación";
  if (score >= 75) return "Base favorable";
  if (score >= 50) return "Requiere validación";
  return "Riesgo elevado";
}

export function CompanyAuditorConsole({ user }: { user: AuthUser }) {
  const [view, setView] = useState<View>("prepare");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [country, setCountry] = useState("");
  const [registrationId, setRegistrationId] = useState("");
  const [taxId, setTaxId] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [declaredAddress, setDeclaredAddress] = useState("");
  const [productContext, setProductContext] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [geminiSource, setGeminiSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompanyAuditResponse | null>(null);
  const [draftSource, setDraftSource] = useState("");
  const [auditHistory, setAuditHistory] = useState<CompanyAuditListItem[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    setLoadingConfig(true);
    getUserConfig(user.username)
      .then((config) => {
        setHasGeminiKey(Boolean(config.has_gemini_key || config.gemini_key));
        setGeminiSource(config.gemini_source || "");
      })
      .catch(() => {
        setHasGeminiKey(false);
        setGeminiSource("");
      })
      .finally(() => setLoadingConfig(false));
  }, [user.username]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COMPANY_AUDIT_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as CompanyAuditDraft;
      setCompanyName(draft.company_name || "");
      setWebsite(draft.website || "");
      setCountry(draft.country || "");
      setRegistrationId(draft.registration_id || "");
      setTaxId(draft.tax_id || "");
      setContactEmail(draft.contact_email || "");
      setContactPhone(draft.contact_phone || "");
      setDeclaredAddress(draft.declared_address || "");
      setProductContext(draft.product_context || "");
      setNotes(draft.notes || "");
      setDraftSource(draft.source === "proveedores" ? "Proveedor precargado desde el resultado de sourcing." : "");
      window.localStorage.removeItem(COMPANY_AUDIT_DRAFT_KEY);
    } catch {
      // La entrada manual permanece disponible cuando el navegador bloquea almacenamiento.
    }
  }, []);

  async function loadAuditHistory(search = historySearch) {
    setLoadingHistory(true);
    try {
      const response = await listCompanyAudits({ search: search.trim(), limit: 60 });
      setAuditHistory(response.audits || []);
    } catch {
      setAuditHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadAuditHistory("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!companyName.trim()) {
      setError("Indica el nombre de la empresa o proveedor.");
      return;
    }
    if (!hasGeminiKey) {
      setError("La IA no está configurada. Admin debe cargar una llave global.");
      return;
    }

    setLoading(true);
    try {
      const response = await auditCompany({
        username: user.username,
        company_name: companyName.trim(),
        website: website.trim(),
        country: country.trim(),
        registration_id: registrationId.trim(),
        tax_id: taxId.trim(),
        contact_email: contactEmail.trim(),
        contact_phone: contactPhone.trim(),
        declared_address: declaredAddress.trim(),
        product_context: productContext.trim(),
        notes: notes.trim()
      });
      setResult(response);
      setView("result");
      loadAuditHistory("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo auditar la empresa.");
    } finally {
      setLoading(false);
    }
  }

  function reuseAudit(audit: CompanyAuditListItem) {
    setCompanyName(audit.company_name || "");
    setWebsite(audit.website || audit.domain || "");
    setCountry(audit.country || "");
    setRegistrationId("");
    setTaxId("");
    setContactEmail("");
    setContactPhone("");
    setDeclaredAddress("");
    setProductContext("");
    setNotes("");
    setDraftSource(`Datos recuperados de la auditoría del ${formatAuditDate(audit.created_at)}.`);
    setView("prepare");
  }

  const positives = useMemo(() => listValue(result?.senal_positiva), [result]);
  const alerts = useMemo(() => listValue(result?.senal_alerta), [result]);
  const pending = useMemo(() => listValue(result?.validaciones_pendientes), [result]);
  const questions = useMemo(() => listValue(result?.preguntas_al_proveedor), [result]);
  const safeguards = useMemo(() => listValue(result?.reglas_seguridad_aplicadas), [result]);
  const technical = result?.auditoria_tecnica;
  const rdap = technical?.rdap;
  const sslInfo = technical?.ssl;
  const web = technical?.website;
  const score = typeof result?.score_final === "number" ? result.score_final : technical?.scorecard?.score;
  const grounded = result?.engine === "gemini_google_search";
  const identity = result?.identidad_legal;
  const sanctions = result?.sanciones;
  const adverse = result?.reputacion_adversa;
  const consistency = result?.coherencia_datos;

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Riesgo comercial"
          title="Auditor IA de proveedores"
          copy="Verifica identidad digital, antigüedad del dominio, contacto y señales comerciales antes de solicitar una cotización o realizar un pago."
          actions={
            <StatusBadge tone={loadingConfig ? "warn" : hasGeminiKey ? "ok" : "danger"}>
              {loadingConfig ? "Verificando IA" : hasGeminiKey ? `IA lista${geminiSource === "admin_global" ? " · Admin" : ""}` : "IA no configurada"}
            </StatusBadge>
          }
        />
      </ModuleSection>

      <ModuleSection className="p-2">
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setView("prepare")} className={`app-tab-button ${view === "prepare" ? "app-tab-button-active" : ""}`}>
            Preparar <span>Empresa</span>
          </button>
          <button type="button" onClick={() => result && setView("result")} disabled={!result} className={`app-tab-button ${view === "result" ? "app-tab-button-active" : ""}`}>
            Resultado <span>{result ? "Disponible" : "Pendiente"}</span>
          </button>
          <button type="button" onClick={() => setView("history")} className={`app-tab-button ${view === "history" ? "app-tab-button-active" : ""}`}>
            Historial <span>{auditHistory.length} registros</span>
          </button>
        </div>
      </ModuleSection>

      {error ? (
        <div className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {view === "prepare" ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ModuleSection>
            <form onSubmit={submitAudit}>
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-brand"><SearchCheck className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-base font-semibold text-ink">¿A quién vamos a validar?</h2>
                  <p className="mt-1 text-sm leading-6 text-muted">El nombre es obligatorio. La web ayuda a confirmar que estás auditando la empresa correcta.</p>
                </div>
              </div>

              {draftSource ? <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-brand">{draftSource}</div> : null}

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-ink">Empresa o proveedor *</span>
                  <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} className="app-input" placeholder="Ej: ABC Industrial Supply" autoComplete="organization" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-ink">Sitio web</span>
                  <input value={website} onChange={(event) => setWebsite(event.target.value)} className="app-input" placeholder="empresa.com" inputMode="url" />
                </label>
              </div>

              <details className="mt-5 rounded-lg border border-line bg-slate-50 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-ink">Agregar contexto para una auditoría más precisa</summary>
                <div className="mt-4 grid gap-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-ink">País o región esperada</span>
                    <input value={country} onChange={(event) => setCountry(event.target.value)} className="app-input" placeholder="Ej: Estados Unidos, China, Europa" />
                  </label>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-ink">Registro mercantil</span>
                      <input value={registrationId} onChange={(event) => setRegistrationId(event.target.value)} className="app-input" placeholder="Número de registro, licencia o LEI" />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-ink">Identificación fiscal</span>
                      <input value={taxId} onChange={(event) => setTaxId(event.target.value)} className="app-input" placeholder="EIN, VAT, RUC u otro" />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-ink">Dirección declarada</span>
                    <input value={declaredAddress} onChange={(event) => setDeclaredAddress(event.target.value)} className="app-input" placeholder="Dirección comercial indicada por el proveedor" autoComplete="street-address" />
                  </label>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-ink">Correo de contacto</span>
                      <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className="app-input" placeholder="ventas@empresa.com" autoComplete="email" />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-ink">Teléfono de contacto</span>
                      <input type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} className="app-input" placeholder="Código de país y número" autoComplete="tel" />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-ink">Producto o contexto comercial</span>
                    <textarea value={productContext} onChange={(event) => setProductContext(event.target.value)} rows={3} className="app-input min-h-24 resize-y py-3" placeholder="Producto, marca, código ACP o renglones que debe cotizar" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-ink">Señal que te preocupa</span>
                    <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="app-input min-h-24 resize-y py-3" placeholder="Ej: precio inusualmente bajo, pago a cuenta personal o correo gratuito" />
                  </label>
                </div>
              </details>

              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-muted">Preauditoría operativa. La aprobación financiera y legal sigue siendo manual.</p>
                <Button type="submit" disabled={loading || loadingConfig || !hasGeminiKey} variant="primary" size="lg">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {loading ? "Verificando fuentes..." : "Auditar empresa"}
                </Button>
              </div>
            </form>
          </ModuleSection>

          <ModuleSection className="self-start">
            <h2 className="text-base font-semibold text-ink">Qué revisa el sistema</h2>
            <div className="mt-4 space-y-3">
              {[
                [Globe2, "Identidad digital", "Dominio, web, país y coherencia corporativa."],
                [ShieldCheck, "Controles técnicos", "RDAP/WHOIS, edad del dominio, SSL y contacto."],
                [Search, "Evidencia pública", "Señales comerciales y fuentes encontradas en la web."],
                [ShieldAlert, "Riesgo operativo", "Alertas, validaciones y preguntas antes de pagar."]
              ].map(([Icon, title, copy]) => {
                const ItemIcon = Icon as typeof Globe2;
                return <div key={String(title)} className="flex gap-3 border-t border-line pt-3 first:border-0 first:pt-0"><ItemIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><div><div className="text-sm font-semibold text-ink">{String(title)}</div><p className="mt-1 text-xs leading-5 text-muted">{String(copy)}</p></div></div>;
              })}
            </div>
          </ModuleSection>
        </div>
      ) : null}

      {view === "result" ? (
        result ? (
          <div className="space-y-5">
            <ModuleSection>
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={decisionTone(result.decision)}>{cleanValue(result.decision, "Pedir validación")}</StatusBadge>
                    <StatusBadge tone={riskTone(result.riesgo)}>Riesgo {cleanValue(result.riesgo, "Medio")}</StatusBadge>
                    <StatusBadge tone={confidenceTone(result.confianza)}>Confianza {cleanValue(result.confianza, "Media")}</StatusBadge>
                  </div>
                  <h2 className="mt-4 break-words text-xl font-semibold text-ink">{cleanValue(result.empresa, companyName)}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">{cleanValue(result.resumen, "Auditoría completada.")}</p>
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="text-xs font-semibold uppercase text-brand">Acción recomendada</div>
                    <p className="mt-1 text-sm font-semibold leading-6 text-blue-950">{cleanValue(result.recomendacion_operativa, "Validar documentos corporativos y condiciones de pago antes de comprar.")}</p>
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:w-[390px]">
                  <div className="rounded-lg border border-line bg-slate-50 p-3"><div className="text-xs font-semibold text-muted">Puntaje final</div><div className="mt-1 text-xl font-semibold text-ink">{typeof score === "number" ? `${score}/100` : "N/D"}</div><div className="mt-1 text-xs text-muted">{scoreLabel(score)}</div></div>
                  <div className="rounded-lg border border-line bg-slate-50 p-3"><div className="text-xs font-semibold text-muted">Técnico</div><div className="mt-1 text-xl font-semibold text-ink">{typeof result.score_tecnico === "number" ? result.score_tecnico : "N/D"}</div><div className="mt-1 text-xs text-muted">WHOIS + web</div></div>
                  <div className="col-span-2 rounded-lg border border-line bg-slate-50 p-3 sm:col-span-1"><div className="text-xs font-semibold text-muted">Fuentes</div><div className="mt-1 text-xl font-semibold text-ink">{result.evidence_count ?? 0}</div><div className="mt-1 text-xs text-muted">{grounded ? "Búsqueda web" : "Sin grounding"}</div></div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div className="text-xs leading-5 text-muted">{cleanValue(result.criterio_puntaje, "Resultado combinado con evidencia disponible.")}</div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setView("prepare")}><RotateCcw className="h-4 w-4" />Nueva auditoría</Button>
              </div>
            </ModuleSection>

            {!grounded ? (
              <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                La búsqueda web de Gemini no estuvo disponible. Usa este resultado como orientación y valida manualmente las fuentes antes de comprar.
              </div>
            ) : null}

            <ModuleSection>
              <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileSearch className="h-4 w-4 text-brand" />
                    <h3 className="text-base font-semibold text-ink">Informe de debida diligencia</h3>
                  </div>
                  <p className="mt-4 whitespace-pre-line text-sm leading-7 text-ink">
                    {cleanValue(result.analisis_escrito, result.resumen || "No hay informe narrativo disponible.")}
                  </p>
                  <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">
                    {cleanValue(result.alcance, "Preauditoría operativa basada en fuentes públicas; requiere validación humana antes de efectuar pagos.")}
                  </p>
                </div>
                <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-slate-50">
                  {[
                    [Building2, "Identidad legal", identity?.estado, identity?.detalle],
                    [Scale, "Sanciones", sanctions?.estado, sanctions?.detalle],
                    [FileSearch, "Reputación adversa", adverse?.estado, adverse?.detalle],
                    [GitCompareArrows, "Coherencia de datos", consistency?.estado, consistency?.detalle]
                  ].map(([Icon, label, state, detail]) => {
                    const RowIcon = Icon as typeof Building2;
                    return <div key={String(label)} className="flex min-w-0 gap-3 p-4">
                      <RowIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-ink">{String(label)}</div>
                          <StatusBadge tone={verificationTone(String(state || ""))}>{cleanValue(state, "No verificado")}</StatusBadge>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted">{cleanValue(detail, "Sin evidencia concluyente.")}</p>
                      </div>
                    </div>;
                  })}
                </div>
              </div>
            </ModuleSection>

            <div className="grid min-w-0 gap-5 xl:grid-cols-2">
              <ModuleSection>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><h3 className="text-sm font-semibold text-ink">Señales favorables</h3></div>
                <div className="mt-4 space-y-3">
                  {(positives.length ? positives : ["No se confirmó una señal favorable suficiente."]).map((item) => <div key={item} className="flex gap-3 border-t border-line pt-3 text-sm leading-6 text-ink first:border-0 first:pt-0"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-600" /><span>{item}</span></div>)}
                </div>
              </ModuleSection>
              <ModuleSection>
                <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-rose-600" /><h3 className="text-sm font-semibold text-ink">Por qué requiere atención</h3></div>
                <div className="mt-4 space-y-3">
                  {(alerts.length ? alerts : ["No se detectaron alertas concretas; conserva la validación comercial estándar."]).map((item) => <div key={item} className="flex gap-3 border-t border-line pt-3 text-sm leading-6 text-ink first:border-0 first:pt-0"><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-rose-600" /><span>{item}</span></div>)}
                </div>
                {safeguards.length ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="text-xs font-semibold text-amber-900">Reglas de seguridad aplicadas</div><ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">{safeguards.map((item) => <li key={item}>• {item}</li>)}</ul></div> : null}
              </ModuleSection>
            </div>

            <ModuleSection>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div><h3 className="text-base font-semibold text-ink">Qué validar antes de avanzar</h3><p className="mt-1 text-sm text-muted">Checklist práctico para solicitar evidencia al proveedor.</p></div>
                <StatusBadge tone="info">{pending.length} pendientes</StatusBadge>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {(pending.length ? pending : ["Confirmar identidad fiscal, dirección, cuenta bancaria corporativa y capacidad técnica."]).map((item) => <label key={item} className="flex items-start gap-3 rounded-lg border border-line bg-slate-50 p-3 text-sm leading-6 text-ink"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-blue-600" /><span>{item}</span></label>)}
              </div>
              {questions.length ? <details className="mt-4 rounded-lg border border-line bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold text-ink">Preguntas sugeridas al proveedor ({questions.length})</summary><div className="mt-3 space-y-2">{questions.map((item) => <div key={item} className="border-t border-line pt-2 text-sm leading-6 text-ink first:border-0 first:pt-0">{item}</div>)}</div></details> : null}
            </ModuleSection>

            <details className="app-surface p-5">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Verificación técnica: dominio, WHOIS, SSL y contacto</summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Dominio", technical?.domain || "No confirmado", `Edad: ${daysLabel(rdap?.domain_age_days)}`],
                  ["RDAP / WHOIS", rdap?.available ? "Disponible" : "No disponible", `Registrador: ${cleanValue(rdap?.registrar, "N/D")}`],
                  ["SSL / TLS", sslInfo?.valid ? "Válido" : "No confirmado", `Expira: ${daysLabel(sslInfo?.expires_in_days)}`],
                  ["Web y contacto", web?.available ? "Accesible" : "No accesible", `Contacto: ${yesNo(web?.has_contact_page)} · HTTPS: ${yesNo(web?.https)}`]
                ].map(([label, value, detail]) => <div key={label} className="rounded-lg border border-line bg-slate-50 p-3"><div className="text-xs font-semibold text-muted">{label}</div><div className="mt-2 break-words text-sm font-semibold text-ink">{value}</div><div className="mt-1 break-words text-xs leading-5 text-muted">{detail}</div></div>)}
              </div>
              {(web?.emails || []).length ? <div className="mt-4 text-sm leading-6 text-ink"><span className="font-semibold">Correos publicados:</span> {(web?.emails || []).join(", ")}</div> : null}
            </details>

            <details className="app-surface p-5" open={false}>
              <summary className="cursor-pointer text-sm font-semibold text-ink">Fuentes y evidencia revisada ({result.evidence_count ?? 0})</summary>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {(result.evidencia || []).map((item, index) => (
                  <div key={`${item.titulo}-${index}`} className="rounded-lg border border-line bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-ink">{cleanValue(item.titulo, `Evidencia ${index + 1}`)}</div>
                      <StatusBadge tone={item.verificado ? "ok" : "neutral"}>
                        {item.verificado ? "Comprobación directa" : cleanValue(item.nivel_fuente, "Fuente pública")}
                      </StatusBadge>
                    </div>
                    <div className="mt-2 text-xs font-semibold text-brand">{cleanValue(item.categoria, "Investigación web")}</div>
                    <p className="mt-2 text-sm leading-6 text-muted">{cleanValue(item.detalle, "Sin detalle.")}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      {item.url
                        ? <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">Abrir fuente <ExternalLink className="h-3.5 w-3.5" /></a>
                        : <span className="text-xs text-muted">Comprobación sin enlace externo</span>}
                      <span className="text-xs text-muted">{formatAuditDate(item.fecha_consulta)}</span>
                    </div>
                  </div>
                ))}
                {!(result.evidencia || []).length ? <EmptyState icon={Search} title="Sin fuentes detalladas" copy="Valida manualmente la identidad y los documentos antes de comprar." className="lg:col-span-2" /> : null}
              </div>
            </details>
          </div>
        ) : <ModuleSection><EmptyState icon={ShieldCheck} title="Aún no hay una auditoría" copy="Completa el nombre de la empresa y ejecuta la validación." /></ModuleSection>
      ) : null}

      {view === "history" ? (
        <ModuleSection>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div><div className="flex items-center gap-2"><History className="h-5 w-5 text-brand" /><h2 className="text-base font-semibold text-ink">Memoria corporativa de proveedores</h2></div><p className="mt-1 text-sm leading-6 text-muted">Visible para Analistas, Supervisores y Gerencia. Evita repetir validaciones sin contexto.</p></div>
            <form className="flex min-w-0 gap-2" onSubmit={(event) => { event.preventDefault(); loadAuditHistory(historySearch); }}>
              <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} className="app-input min-w-0 sm:w-72" placeholder="Empresa, dominio o decisión" />
              <Button type="submit" variant="secondary" size="icon" title="Buscar auditorías">{loadingHistory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button>
              <Button type="button" variant="ghost" size="icon" title="Actualizar historial" onClick={() => loadAuditHistory(historySearch)}><RefreshCw className="h-4 w-4" /></Button>
            </form>
          </div>

          <div className="mt-5 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {auditHistory.map((audit) => (
              <div key={audit.id} className="grid min-w-0 gap-3 bg-panel p-4 transition hover:bg-slate-50 lg:grid-cols-[minmax(0,1fr)_110px_130px_170px_auto] lg:items-center">
                <div className="min-w-0"><div className="break-words text-sm font-semibold text-ink">{cleanValue(audit.company_name, "Sin nombre")}</div><div className="mt-1 break-words text-xs text-muted">{cleanValue(audit.domain || audit.website, "Sin dominio confirmado")}</div></div>
                <div><div className="text-xs text-muted">Puntaje</div><div className="mt-1 text-sm font-semibold text-ink">{typeof audit.score_final === "number" ? `${audit.score_final}/100` : "N/D"}</div></div>
                <div className="flex flex-wrap gap-2 lg:block"><StatusBadge tone={riskTone(audit.riesgo)}>Riesgo {cleanValue(audit.riesgo, "N/D")}</StatusBadge></div>
                <div><div className="text-xs text-muted">{formatAuditDate(audit.created_at)}</div><div className="mt-1 text-xs text-muted">Por {cleanValue(audit.username, "N/D")}</div></div>
                <Button type="button" variant="secondary" size="sm" onClick={() => reuseAudit(audit)}><RotateCcw className="h-4 w-4" />Revisar de nuevo</Button>
              </div>
            ))}
            {!auditHistory.length ? <EmptyState icon={History} title="No hay auditorías con ese filtro" copy="Cambia la búsqueda o crea la primera auditoría corporativa." /> : null}
          </div>
        </ModuleSection>
      ) : null}
    </div>
  );
}
