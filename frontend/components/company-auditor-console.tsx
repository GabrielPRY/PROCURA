"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, SearchCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
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
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

function riskTone(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("bajo")) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (normalized.includes("alto")) return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function decisionTone(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("avanzar") && !normalized.includes("cautela")) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (normalized.includes("descartar")) return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function scoreTone(value?: number) {
  if (typeof value !== "number") return "border-slate-200 bg-slate-50 text-slate-700";
  if (value >= 75) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (value < 50) return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function formatAuditDate(value?: string) {
  if (!value) return "N/D";
  try {
    return new Intl.DateTimeFormat("es-PA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function decisionCopy(decision?: string, risk?: string) {
  const text = `${decision || ""} ${risk || ""}`.toLowerCase();
  if (text.includes("descartar") || text.includes("alto")) {
    return "No avanzar sin validacion documental fuerte, contacto corporativo y condiciones de pago seguras.";
  }
  if (text.includes("avanzar") && !text.includes("cautela") && !text.includes("medio")) {
    return "Puede avanzar a solicitud de cotizacion, manteniendo verificacion de ficha tecnica, pagos y trazabilidad.";
  }
  return "Avanzar con cautela: pedir evidencia corporativa, ficha tecnica, referencias y condiciones comerciales antes de comprar.";
}

function listValue(items?: string[]) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function yesNo(value?: boolean) {
  if (value === true) return "Si";
  if (value === false) return "No";
  return "N/D";
}

function daysLabel(value?: number | null) {
  if (typeof value !== "number") return "N/D";
  if (value >= 730) return `${Math.floor(value / 365)} anos`;
  return `${value} dias`;
}

export function CompanyAuditorConsole({ user }: { user: AuthUser }) {
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [country, setCountry] = useState("");
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
      if (draft.company_name) setCompanyName(draft.company_name);
      if (draft.website) setWebsite(draft.website);
      if (draft.country) setCountry(draft.country);
      if (draft.product_context) setProductContext(draft.product_context);
      if (draft.notes) setNotes(draft.notes);
      if (draft.source === "proveedores") setDraftSource("Datos precargados desde Proveedores.");
      window.localStorage.removeItem(COMPANY_AUDIT_DRAFT_KEY);
    } catch {
      // El auditor tambien funciona con entrada manual.
    }
  }, []);

  async function loadAuditHistory(search = historySearch) {
    setLoadingHistory(true);
    try {
      const response = await listCompanyAudits({ search: search.trim(), limit: 40 });
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
      setError("Falta Gemini. Admin debe cargar una llave global o asignarla al usuario.");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const response = await auditCompany({
        username: user.username,
        company_name: companyName.trim(),
        website: website.trim(),
        country: country.trim(),
        product_context: productContext.trim(),
        notes: notes.trim()
      });
      setResult(response);
      loadAuditHistory(companyName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo auditar la empresa.");
    } finally {
      setLoading(false);
    }
  }

  const positives = listValue(result?.senal_positiva);
  const alerts = listValue(result?.senal_alerta);
  const pending = listValue(result?.validaciones_pendientes);
  const questions = listValue(result?.preguntas_al_proveedor);
  const technical = result?.auditoria_tecnica;
  const rdap = technical?.rdap;
  const sslInfo = technical?.ssl;
  const web = technical?.website;
  const technicalScore = result?.score_final ?? technical?.scorecard?.score;
  const operativeDecision = cleanValue(result?.decision, "Pedir validacion");
  const operativeRisk = cleanValue(result?.riesgo, "Medio");
  const operativeConfidence = cleanValue(result?.confianza, "Media");
  const auditChecklist = [
    ["Identidad", cleanValue(result?.empresa, companyName || "No confirmado")],
    ["Dominio", technical?.domain || cleanValue(result?.website, website || "No confirmado")],
    ["Riesgo", operativeRisk],
    ["Accion", decisionCopy(result?.decision, result?.riesgo)]
  ];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Auditor IA"
          title="Auditoria de empresas y proveedores"
          copy="Evalua si un proveedor parece real, trazable y seguro antes de pedir cotizacion, negociar o comprar."
          actions={<StatusBadge tone={loadingConfig ? "warn" : hasGeminiKey ? "ok" : "warn"}>{loadingConfig ? "Verificando API" : hasGeminiKey ? geminiSource === "admin_global" ? "Gemini Admin" : "Gemini usuario" : "Falta Gemini"}</StatusBadge>}
        />
      </ModuleSection>

      <section className="grid gap-4 xl:grid-cols-[0.42fr_0.58fr]">
        <form onSubmit={submitAudit} className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <SearchCheck className="h-5 w-5 text-brand" />
            Datos para auditar
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">
            Mientras mas datos entregues, mas util sera la auditoria. Si no tienes web o pais, deja el campo en blanco.
          </p>
          {draftSource ? (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
              {draftSource}
            </div>
          ) : null}

          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Empresa o proveedor</span>
            <input
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              className="app-input"
              placeholder="Ej: Rexroth distributor, ABC Industrial Supply..."
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Web o link</span>
            <input
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              className="app-input"
              placeholder="https://..."
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Pais o region</span>
            <input
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="app-input"
              placeholder="Ej: China, USA, Europa, no confirmado..."
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Producto o contexto</span>
            <textarea
              value={productContext}
              onChange={(event) => setProductContext(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-line bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
              placeholder="Que producto quieres comprar, marca/modelo, renglon o descripcion tecnica..."
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Notas de riesgo</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-line bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
              placeholder="Ej: solo acepta transferencia, correo personal, precio demasiado bajo, no tiene direccion..."
            />
          </label>

          <Button type="submit" disabled={loading || loadingConfig} variant="primary" size="lg" className="mt-5 w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {loading ? "Auditando..." : "Auditar empresa"}
          </Button>

          {error ? (
            <div className="mt-4 flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}
        </form>

        <div className="space-y-4">
          {result ? (
            <>
              <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-wide text-brand">Decision operativa</div>
                    <div className="mt-2 break-words text-2xl font-semibold text-slate-950">{operativeDecision}</div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">{cleanValue(result.resumen, "Auditoria generada.")}</p>
                  </div>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:w-[420px]">
                    <div className={`rounded-lg border p-3 text-center ${scoreTone(typeof technicalScore === "number" ? technicalScore : undefined)}`}>
                      <div className="text-xs font-semibold opacity-75">Score</div>
                      <div className="mt-1 text-xl font-semibold">{typeof technicalScore === "number" ? `${technicalScore}/100` : "N/D"}</div>
                    </div>
                    <div className={`rounded-lg border p-3 text-center ${riskTone(result.riesgo)}`}>
                      <div className="text-xs font-semibold opacity-75">Riesgo</div>
                      <div className="mt-1 text-xl font-semibold">{operativeRisk}</div>
                    </div>
                    <div className="rounded-lg border border-line bg-slate-50 p-3 text-center text-slate-800">
                      <div className="text-xs font-semibold text-muted">Confianza</div>
                      <div className="mt-1 text-xl font-semibold">{operativeConfidence}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {auditChecklist.map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                      <div className="mt-2 break-words text-sm font-semibold leading-5 text-slate-900">{value}</div>
                    </div>
                  ))}
                </div>

                <div className={`mt-4 rounded-lg border p-4 text-sm leading-6 ${decisionTone(result.decision)}`}>
                  <div className="font-semibold">Siguiente accion</div>
                  <p className="mt-1">{cleanValue(result.recomendacion_operativa, decisionCopy(result.decision, result.riesgo))}</p>
                </div>
              </section>

              {technical ? (
                <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Verificacion tecnica automatica</div>
                      <p className="mt-1 text-sm text-muted">
                        RDAP/WHOIS, SSL/TLS, HTTPS y senales basicas de contacto web.
                      </p>
                    </div>
                    <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskTone(result.riesgo_tecnico || technical.scorecard?.riesgo_tecnico)}`}>
                      {cleanValue(result.decision_tecnica || technical.scorecard?.decision_tecnica, "Pedir validacion")}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="app-data-card">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Dominio</div>
                      <div className="mt-2 break-words text-sm font-semibold text-slate-900">{technical.domain || "No confirmado"}</div>
                      <div className="mt-1 text-xs text-muted">Edad: {daysLabel(rdap?.domain_age_days)}</div>
                    </div>
                    <div className="app-data-card">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">RDAP/WHOIS</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">{rdap?.available ? "Disponible" : "No disponible"}</div>
                      <div className="mt-1 text-xs text-muted">Registrador: {cleanValue(rdap?.registrar, "N/D")}</div>
                    </div>
                    <div className="app-data-card">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">SSL/TLS</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">{sslInfo?.valid ? "Valido" : "No confirmado"}</div>
                      <div className="mt-1 text-xs text-muted">Expira: {daysLabel(sslInfo?.expires_in_days)}</div>
                    </div>
                    <div className="app-data-card">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Web/contacto</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">{web?.available ? "Accesible" : "No accesible"}</div>
                      <div className="mt-1 text-xs text-muted">Contacto: {yesNo(web?.has_contact_page)} | HTTPS: {yesNo(web?.https)}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="app-data-card">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Correos detectados</div>
                      <div className="mt-2 text-sm leading-6 text-slate-700">
                        {(web?.emails || []).length ? (web?.emails || []).join(", ") : "No confirmado"}
                      </div>
                      {web?.free_email_detected ? (
                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                          Alerta: correo gratuito detectado.
                        </div>
                      ) : null}
                    </div>
                    <div className="app-data-card">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Nameservers</div>
                      <div className="mt-2 text-sm leading-6 text-slate-700">
                        {(rdap?.nameservers || []).length ? (rdap?.nameservers || []).join(", ") : "No confirmado"}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Senales positivas
                  </div>
                  <div className="mt-3 space-y-2">
                    {(positives.length ? positives : ["No confirmado."]).map((item) => (
                      <div key={item} className="rounded-lg border border-line bg-slate-50 p-3 text-sm leading-6 text-slate-700">{item}</div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                    Alertas de riesgo
                  </div>
                  <div className="mt-3 space-y-2">
                    {(alerts.length ? alerts : ["Sin alertas concretas detectadas, pero validar datos corporativos antes de comprar."]).map((item) => (
                      <div key={item} className="rounded-lg border border-line bg-slate-50 p-3 text-sm leading-6 text-slate-700">{item}</div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900">Validaciones pendientes</div>
                  <div className="mt-3 space-y-2">
                    {(pending.length ? pending : ["Pedir ficha tecnica, datos fiscales, direccion, contacto corporativo y condiciones de pago."]).map((item) => (
                      <div key={item} className="rounded-lg border border-line bg-slate-50 p-3 text-sm leading-6 text-slate-700">{item}</div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900">Preguntas al proveedor</div>
                  <div className="mt-3 space-y-2">
                    {(questions.length ? questions : ["Solicitar referencias, ficha tecnica, direccion, cuenta bancaria corporativa, Incoterm, lead time y Net 30 si aplica."]).map((item) => (
                      <div key={item} className="rounded-lg border border-line bg-slate-50 p-3 text-sm leading-6 text-slate-700">{item}</div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Evidencia revisada</div>
                    <p className="mt-1 text-sm text-muted">{result.engine || "gemini"} | {result.evidence_count ?? 0} senales</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {(result.evidencia || []).map((item, index) => (
                    <div key={`${item.titulo}-${index}`} className="app-data-card">
                      <div className="text-sm font-semibold text-slate-900">{cleanValue(item.titulo, `Evidencia ${index + 1}`)}</div>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{cleanValue(item.detalle, "Sin detalle.")}</p>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                          Abrir fuente <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  ))}
                  {!(result.evidencia || []).length ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-muted">
                      No se recibio evidencia detallada. Usa las validaciones pendientes antes de confiar en el proveedor.
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          ) : (
            <section className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-sm leading-6 text-muted">
              Aun no hay auditoria. Ingresa una empresa o proveedor y ejecuta la revision. El resultado debe ayudarte a decidir si avanzar,
              pedir mas evidencia o descartar.
            </section>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-base font-semibold text-slate-900">Historial de proveedores auditados</div>
            <p className="mt-1 text-sm text-muted">Memoria corporativa: aprobados, en validacion y descartados.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
              placeholder="Buscar proveedor, dominio o decision"
            />
            <button
              type="button"
              onClick={() => loadAuditHistory(historySearch)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-brand"
            >
              {loadingHistory ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refrescar
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {auditHistory.map((audit) => (
            <div key={audit.id} className="rounded-xl border border-line bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="break-words text-sm font-semibold text-slate-950">{cleanValue(audit.company_name, "Sin nombre")}</div>
                  <div className="mt-1 break-words text-xs text-muted">{cleanValue(audit.website || audit.domain, "Sin web confirmada")}</div>
                </div>
                <div className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${decisionTone(audit.decision)}`}>
                  {cleanValue(audit.decision, "Validar")}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className={`rounded-lg border p-2 ${scoreTone(typeof audit.score_final === "number" ? audit.score_final : undefined)}`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">Score</div>
                  <div className="mt-1 text-sm font-semibold">{typeof audit.score_final === "number" ? `${audit.score_final}/100` : "N/D"}</div>
                </div>
                <div className={`rounded-lg border p-2 ${riskTone(audit.riesgo)}`}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">Riesgo</div>
                  <div className="mt-1 text-sm font-semibold">{cleanValue(audit.riesgo, "Medio")}</div>
                </div>
                <div className="rounded-lg border border-line bg-slate-50 p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Fecha</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{formatAuditDate(audit.created_at)}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="rounded-full border border-line bg-slate-50 px-2 py-1">Usuario: {cleanValue(audit.username, "N/D")}</span>
                <span className="rounded-full border border-line bg-slate-50 px-2 py-1">Dominio: {cleanValue(audit.domain, "N/D")}</span>
              </div>
            </div>
          ))}
          {!auditHistory.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-muted lg:col-span-2">
              Todavia no hay auditorias guardadas o no hay resultados para ese filtro.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}







