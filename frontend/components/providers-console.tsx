"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Globe2,
  Loader2,
  ListFilter,
  PackageSearch,
  Search,
  ShieldCheck,
  Sparkles,
  Target
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type AuthUser } from "@/lib/auth";
import { COMPANY_AUDIT_DRAFT_KEY, listCompanyAudits, type CompanyAuditDraft, type CompanyAuditListItem } from "@/lib/company-audit";
import type { ModuleId } from "@/lib/navigation";
import {
  asBool,
  asOptionalBool,
  cleanValue,
  getUserConfig,
  loadActiveRfqContext,
  loadLastRfq,
  type RfqAnalysisResponse,
  type RfqItem
} from "@/lib/rfq";
import { searchProviders, type SourcingProvider, type SourcingSearchPlan } from "@/lib/sourcing";
import { saveSupplierEvaluationDraft } from "@/lib/evaluation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type Strategy = "proveedor_integral" | "por_renglon";
type View = "prepare" | "results";
type BadgeTone = "neutral" | "info" | "ok" | "warn" | "danger";
type ResultFilter = "todos" | "cobertura" | "bajo_riesgo" | "auditados";
type ResultSort = "recomendados" | "cobertura" | "tecnico" | "precio";

const starterPrompts = [
  "Prioriza fabricante directo y stock disponible.",
  "Busca el precio más bajo sin sacrificar cumplimiento técnico.",
  "Incluye marketplaces B2B solo cuando el proveedor sea trazable."
];

function itemLabel(item: RfqItem, index: number) {
  const line = cleanValue(item.renglon, String(index + 1));
  const code = cleanValue(item.codigo_articulo, "S/C");
  const description = cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "Sin descripción");
  return `Renglón ${line} | ${code} | ${description.slice(0, 78)}`;
}

function queryFromItem(item?: RfqItem) {
  if (!item) return "";
  return Array.from(new Set([
    cleanValue(item.termino_de_busqueda_corto, ""),
    cleanValue(item.marca_modelo_requerido, ""),
    cleanValue(item.codigo_articulo, ""),
    cleanValue(item.descripcion || item.ficha_tecnica_completa, "").slice(0, 150)
  ].filter(Boolean))).join(" ");
}

function sourceLinks(query: string) {
  const encoded = encodeURIComponent(query || "industrial supplier");
  return [
    ["Google Global", `https://www.google.com/search?q=${encoded}+manufacturer+distributor+stock+price+datasheet`],
    ["Alibaba", `https://www.alibaba.com/trade/search?SearchText=${encoded}`],
    ["Made-in-China", `https://www.made-in-china.com/products-search/hot-china-products/${encoded}.html`],
    ["Global Sources", `https://www.globalsources.com/search?query=${encoded}`],
    ["Thomasnet", `https://www.thomasnet.com/search.html?cov=NA&what=${encoded}`],
    ["Europages", `https://www.europages.com/en/search?q=${encoded}`]
  ];
}

function normalizeCompanyName(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(inc|corp|corporation|co|company|llc|ltd|limited|sa|gmbh|group|international|intl)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function domainFromUrl(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function riskTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("bajo")) return "ok";
  if (normalized.includes("alto")) return "danger";
  return "warn";
}

function decisionTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("recomendado") || normalized.includes("avanzar") || normalized.includes("aprob")) return "ok";
  if (normalized.includes("descartar") || normalized.includes("bloquear")) return "danger";
  return "warn";
}

function providerCoverage(provider: SourcingProvider) {
  const declared = Number(provider.cobertura_renglones || 0);
  const listed = provider.renglones_cubiertos?.length || 0;
  return Math.max(Number.isFinite(declared) ? declared : 0, listed);
}

function providerRankScore(provider: SourcingProvider, selectedCount: number) {
  const backendScore = Number(provider.puntaje_ranking);
  if (Number.isFinite(backendScore)) return Math.max(0, Math.min(100, Math.round(backendScore)));

  const technicalStatus = String(provider.estado_tecnico || "").toLowerCase();
  const technical = technicalStatus.includes("confirmado") ? 50
    : technicalStatus.includes("compatible") ? 32
      : technicalStatus.includes("no cumple") ? 0 : 12;
  const coverage = selectedCount ? Math.min(1, providerCoverage(provider) / selectedCount) * 15 : 0;
  const priceStatus = String(provider.estado_precio || "").toLowerCase();
  const price = priceStatus.includes("publicado") ? 20 : priceStatus.includes("cotizacion") ? 8 : 0;
  const risk = String(provider.riesgo || "").toLowerCase().includes("bajo") ? 15
    : String(provider.riesgo || "").toLowerCase().includes("alto") ? 0 : 7;
  return Math.round(technical + coverage + price + risk);
}

function technicalTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("confirmado")) return "ok";
  if (normalized.includes("no cumple")) return "danger";
  if (normalized.includes("compatible")) return "warn";
  return "neutral";
}

function priceTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("publicado")) return "ok";
  if (normalized.includes("cotizacion")) return "info";
  return "neutral";
}

function itemPayload(item: RfqItem) {
  return {
    renglon: cleanValue(item.renglon, ""),
    codigo_acp: cleanValue(item.codigo_articulo, ""),
    descripcion: cleanValue(item.ficha_tecnica_completa || item.descripcion, ""),
    busqueda_sugerida: cleanValue(item.termino_de_busqueda_corto, ""),
    cantidad: cleanValue(item.cantidad, ""),
    unidad: cleanValue(item.unidad_de_medida || item.unidad, ""),
    marca_modelo: cleanValue(item.marca_modelo_requerido, ""),
    acepta_equivalente: asOptionalBool(item.acepta_equivalente),
    requiere_propuesta_tecnica: asBool(item.requiere_propuesta_tecnica),
    requiere_ficha_tecnica: asBool(item.requiere_ficha_tecnica),
    evidencia_tecnica: cleanValue(item.evidencia_tecnica, ""),
    restriccion_detectada: cleanValue(item.restriccion_detectada || item.restriccion_marca, ""),
    requiere_carta_fabricante: asBool(item.requiere_carta_fabricante),
    observaciones: cleanValue(item.observaciones, "")
  };
}

function smartPrompt(items: RfqItem[], strategy: Strategy) {
  const lines = items.map((item, index) => {
    const equivalent = asOptionalBool(item.acepta_equivalente);
    return [
      `Renglón ${cleanValue(item.renglon, String(index + 1))}`,
      `código ACP ${cleanValue(item.codigo_articulo, "no especificado")}`,
      cleanValue(item.marca_modelo_requerido, "") ? `marca/modelo ${cleanValue(item.marca_modelo_requerido, "")}` : "",
      equivalent === false ? "sin equivalentes" : equivalent === true ? "equivalentes permitidos si cumplen" : "equivalencia no confirmada"
    ].filter(Boolean).join(", ");
  });
  return [
    `Busca 10 proveedores globales reales para ${items.length} renglón(es).`,
    strategy === "proveedor_integral"
      ? "Prioriza proveedores que cubran todos los renglones o la mayor cantidad posible."
      : "Busca el mejor proveedor especializado para cada renglón.",
    "Prioridad: cumplimiento técnico verificable, oportunidad de ahorro, stock/lead time y bajo riesgo comercial.",
    "No inventes precios, stock, contactos, certificaciones ni cumplimiento. Toda afirmación debe quedar como confirmada o pendiente de validar.",
    lines.join("\n")
  ].join("\n");
}

export function ProvidersConsole({ user, onModuleChange }: { user: AuthUser; onModuleChange?: (moduleId: ModuleId) => void }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [strategy, setStrategy] = useState<Strategy>("proveedor_integral");
  const [depth, setDepth] = useState("Profunda");
  const [input, setInput] = useState("");
  const [view, setView] = useState<View>("prepare");
  const [searching, setSearching] = useState(false);
  const [summary, setSummary] = useState("");
  const [providers, setProviders] = useState<SourcingProvider[]>([]);
  const [engine, setEngine] = useState("");
  const [searchPlan, setSearchPlan] = useState<SourcingSearchPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [geminiSource, setGeminiSource] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [auditHistory, setAuditHistory] = useState<CompanyAuditListItem[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [resultSearch, setResultSearch] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("todos");
  const [resultSort, setResultSort] = useState<ResultSort>("recomendados");

  useEffect(() => {
    const saved = loadLastRfq(user.username);
    const context = loadActiveRfqContext(user.username);
    const savedItems = saved?.items || [];
    setRfq(saved);
    if (savedItems.length && context?.target_module === "proveedores") {
      const index = Math.min(Math.max(Number(context.item_index) || 0, 0), savedItems.length - 1);
      setSelectedIndexes([index]);
    } else {
      setSelectedIndexes(savedItems.length ? [0] : []);
    }
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

  const items = useMemo(() => rfq?.items || [], [rfq]);
  const selectedItems = useMemo(
    () => selectedIndexes.filter((index) => items[index]).sort((a, b) => a - b).map((index) => items[index]),
    [items, selectedIndexes]
  );
  const rfqNumber = cleanValue(rfq?.condiciones_generales?.numero_licitacion, "Sin RFQ");
  const activeQuery = selectedItems.map(queryFromItem).filter(Boolean).slice(0, 12).join(" | ");
  const grounded = engine === "gemini_google_search";

  const visibleProviders = useMemo(() => {
    const query = resultSearch.trim().toLowerCase();
    const filtered = providers.filter((provider) => {
      const prior = auditForProvider(provider);
      const haystack = [provider.proveedor, provider.pais_region, provider.tipo, provider.renglon, provider.cobertura_detalle]
        .join(" ")
        .toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (resultFilter === "cobertura" && providerCoverage(provider) < selectedItems.length) return false;
      if (resultFilter === "bajo_riesgo" && !String(provider.riesgo || "").toLowerCase().includes("bajo")) return false;
      if (resultFilter === "auditados" && !prior) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (resultSort === "cobertura") return providerCoverage(b) - providerCoverage(a);
      if (resultSort === "tecnico") {
        const value = (provider: SourcingProvider) => {
          const status = String(provider.estado_tecnico || "").toLowerCase();
          return status.includes("confirmado") ? 4 : status.includes("compatible") ? 3 : status.includes("no demostrado") ? 2 : 1;
        };
        return value(b) - value(a);
      }
      if (resultSort === "precio") {
        const value = (provider: SourcingProvider) => String(provider.estado_precio || "").toLowerCase().includes("publicado") ? 3 : String(provider.estado_precio || "").toLowerCase().includes("cotizacion") ? 2 : 1;
        return value(b) - value(a);
      }
      return providerRankScore(b, selectedItems.length) - providerRankScore(a, selectedItems.length);
    });
  }, [providers, resultFilter, resultSearch, resultSort, selectedItems.length, auditHistory]);

  useEffect(() => {
    setExpandedIndex((current) => {
      if (!visibleProviders.length) return null;
      if (current === null || current >= visibleProviders.length) return 0;
      return current;
    });
  }, [visibleProviders.length]);

  useEffect(() => {
    if (!providers.length) {
      setAuditHistory([]);
      return;
    }
    let mounted = true;
    setLoadingAudits(true);
    listCompanyAudits({ limit: 300 })
      .then((response) => { if (mounted) setAuditHistory(response.audits || []); })
      .catch(() => { if (mounted) setAuditHistory([]); })
      .finally(() => { if (mounted) setLoadingAudits(false); });
    return () => { mounted = false; };
  }, [providers.length]);

  function auditForProvider(provider: SourcingProvider) {
    const providerDomain = domainFromUrl(provider.url);
    const providerName = normalizeCompanyName(provider.proveedor);
    return auditHistory.find((audit) => {
      const auditDomain = String(audit.domain || domainFromUrl(audit.website)).toLowerCase();
      if (providerDomain && auditDomain && providerDomain === auditDomain) return true;
      const auditName = normalizeCompanyName(audit.company_name);
      return Boolean(providerName && auditName && (providerName === auditName || providerName.includes(auditName) || auditName.includes(providerName)));
    });
  }

  const selectedProvider = visibleProviders[expandedIndex ?? 0] || null;
  const selectedProviderAudit = selectedProvider ? auditForProvider(selectedProvider) : undefined;

  function sendProviderToAudit(provider: SourcingProvider) {
    const prior = auditForProvider(provider);
    const draft: CompanyAuditDraft = {
      company_name: provider.proveedor || "",
      website: provider.url || "",
      country: provider.pais_region || "",
      product_context: [
        `RFQ: ${rfqNumber}`,
        `Renglones: ${provider.renglones_cubiertos?.join(", ") || provider.renglon || "Por validar"}`,
        provider.evidencia ? `Evidencia de sourcing: ${provider.evidencia}` : "",
        provider.que_validar ? `Pendiente: ${provider.que_validar}` : ""
      ].filter(Boolean).join("\n"),
      notes: [
        provider.tipo ? `Tipo: ${provider.tipo}` : "",
        provider.riesgo ? `Riesgo preliminar: ${provider.riesgo}` : "",
        prior ? `Auditoría previa: ${prior.score_final}/100 | ${prior.decision || "Revisar"}` : ""
      ].filter(Boolean).join("\n"),
      source: "proveedores",
      created_at: new Date().toISOString()
    };
    try {
      window.localStorage.setItem(COMPANY_AUDIT_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // El auditor permite completar los datos manualmente si el navegador bloquea almacenamiento local.
    }
    onModuleChange?.("auditor_empresas");
  }

  function sendProviderToEvaluation(provider: SourcingProvider) {
    saveSupplierEvaluationDraft(user.username, {
      supplier_name: provider.proveedor || "Proveedor seleccionado",
      item_indexes: selectedIndexes,
      provider_url: provider.url || "",
      created_at: new Date().toISOString()
    });
    onModuleChange?.("evaluacion");
  }

  async function runSourcing() {
    if (!selectedItems.length || searching || !hasGeminiKey) return;
    const requestPrompt = [smartPrompt(selectedItems, strategy), input.trim() ? `Condición adicional: ${input.trim()}` : ""].filter(Boolean).join("\n\n");
    setInput("");
    setSearching(true);
    setError(null);
    setSummary("");
    setProviders([]);
    setSearchPlan([]);
    setEngine("");
    try {
      const response = await searchProviders({
        username: user.username,
        items: selectedItems.slice(0, 12).map(itemPayload),
        custom_prompt: requestPrompt,
        depth,
        target_count: 10,
        sourcing_strategy: selectedItems.length > 1 ? strategy : "por_renglon"
      });
      const nextProviders = response.proveedores || [];
      setSummary(response.resumen || "");
      setProviders(nextProviders);
      setEngine(response.engine || "");
      setSearchPlan(response.search_plan || []);
      setExpandedIndex(nextProviders.length ? 0 : null);
      setView("results");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo completar la búsqueda.";
      setError(message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-5">
      <ModuleSection>
          <PageHeader
            eyebrow="Sourcing global"
          title="Encuentra proveedores que sí pueden cotizar"
          copy="Selecciona renglones y compara candidatos globales por evidencia técnica, precio, cobertura y riesgo comercial."
          actions={
            <StatusBadge tone={loadingConfig ? "warn" : hasGeminiKey ? "ok" : "danger"}>
              {loadingConfig ? "Verificando IA" : hasGeminiKey ? `IA lista${geminiSource === "admin_global" ? " · Admin" : ""}` : "IA no configurada"}
            </StatusBadge>
          }
        />
      </ModuleSection>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}</div> : null}

      {!items.length ? (
        <ModuleSection>
          <EmptyState icon={PackageSearch} title="Primero necesitas un RFQ analizado" copy="La búsqueda utiliza códigos, descripciones, marcas y requisitos del RFQ para evitar resultados genéricos." />
        </ModuleSection>
      ) : (
        <>
          <ModuleSection className="p-2">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setView("prepare")} className={`app-tab-button ${view === "prepare" ? "app-tab-button-active" : ""}`}>
                1. Preparar <span>{selectedItems.length} seleccionado(s)</span>
              </button>
              <button type="button" onClick={() => providers.length && setView("results")} disabled={!providers.length} className={`app-tab-button ${view === "results" ? "app-tab-button-active" : ""}`}>
                2. Comparar <span>{providers.length ? `${providers.length} candidatos` : "Pendiente"}</span>
              </button>
            </div>
          </ModuleSection>

          {view === "prepare" ? (
            <div className="grid min-w-0 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
              <ModuleSection className="min-w-0 self-start">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-ink">Renglones a buscar</h2>
                    <p className="mt-1 text-sm text-muted">Selecciona hasta 12 partidas relacionadas.</p>
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIndexes(items.slice(0, 12).map((_, index) => index))}>Todos</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIndexes([])}>Limpiar</Button>
                  </div>
                </div>

                <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto pr-1">
                  {items.map((item, index) => {
                    const checked = selectedIndexes.includes(index);
                    const disabled = !checked && selectedIndexes.length >= 12;
                    return (
                      <label key={`${index}-${cleanValue(item.codigo_articulo, "")}`} className={`flex items-start gap-3 rounded-lg border p-3 transition ${checked ? "border-blue-300 bg-blue-50 text-blue-950" : "border-line bg-panel text-ink hover:border-blue-300"} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => setSelectedIndexes((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((a, b) => a - b))} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold leading-5">{itemLabel(item, index)}</span>
                          <span className="mt-1 block text-xs text-muted">Cant. {cleanValue(item.cantidad, "N/D")} {cleanValue(item.unidad_de_medida || item.unidad, "")}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {selectedItems.length > 1 ? (
                  <div className="mt-5 border-t border-line pt-4">
                    <div className="text-sm font-semibold text-ink">Estrategia</div>
                    <div className="mt-3 grid gap-2">
                      <button type="button" onClick={() => setStrategy("proveedor_integral")} className={`app-action-card p-3 text-left ${strategy === "proveedor_integral" ? "border-blue-400 bg-blue-50" : ""}`}>
                        <span className="block text-sm font-semibold">Máxima cobertura</span>
                        <span className="mt-1 block text-xs leading-5 text-muted">Prioriza empresas capaces de cotizar varios renglones.</span>
                      </button>
                      <button type="button" onClick={() => setStrategy("por_renglon")} className={`app-action-card p-3 text-left ${strategy === "por_renglon" ? "border-blue-400 bg-blue-50" : ""}`}>
                        <span className="block text-sm font-semibold">Especialista por renglón</span>
                        <span className="mt-1 block text-xs leading-5 text-muted">Busca el mejor candidato específico para cada partida.</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </ModuleSection>

              <div className="min-w-0 space-y-5">
                <ModuleSection className="min-w-0 overflow-hidden p-0">
                  <div className="flex items-start gap-3 border-b border-line p-5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-brand"><Target className="h-4 w-4" /></div>
                    <div><h2 className="text-base font-semibold text-ink">Objetivo de la búsqueda</h2><p className="mt-1 text-sm text-muted">La descripción, código ACP, marca y requisitos técnicos ya están incluidos.</p></div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <label className="grid gap-2 text-sm font-semibold text-ink">
                      Instrucción adicional
                      <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Opcional: stock inmediato, marca exacta, región, certificación, condición comercial..." className="min-h-28 w-full p-3 text-sm leading-6" />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {starterPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => setInput(prompt)} className="app-filter-pill app-filter-pill-idle border px-3 py-2 text-left text-xs font-semibold">{prompt}</button>)}
                    </div>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                        Profundidad
                        <select value={depth} onChange={(event) => setDepth(event.target.value)} className="app-input h-10">
                          <option value="Profunda">Profunda</option>
                          <option value="Rapida">Rápida</option>
                        </select>
                      </label>
                      <Button type="button" onClick={() => void runSourcing()} disabled={searching || !selectedItems.length || !hasGeminiKey} variant="primary" size="lg">
                        {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {searching ? "Buscando y verificando..." : "Buscar 10 proveedores"}
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
                      {[
                        ["1", "Comprende", `${selectedItems.length} renglón(es)`],
                        ["2", "Busca", depth === "Profunda" ? "Global profunda" : "Global rápida"],
                        ["3", "Ordena", "Técnico + precio + riesgo"]
                      ].map(([step, label, value]) => <div key={step} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-bold text-brand">{step}</span><div><div className="text-xs font-semibold text-muted">{label}</div><div className="text-sm font-semibold text-ink">{value}</div></div></div>)}
                    </div>
                  </div>
                </ModuleSection>

                <details className="app-surface p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-ink">Fuentes manuales de respaldo</summary>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {sourceLinks(activeQuery).map(([label, href]) => (
                      <a key={label} href={href} target="_blank" rel="noreferrer" className="app-action-card flex items-center justify-between gap-2 p-3 text-sm font-semibold">
                        <span className="inline-flex items-center gap-2"><Globe2 className="h-4 w-4 text-brand" />{label}</span><ExternalLink className="h-4 w-4 text-muted" />
                      </a>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <ModuleSection>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-ink">Candidatos encontrados</h2>
                      <StatusBadge tone={grounded ? "ok" : "warn"}>{grounded ? "Búsqueda web activa" : "Sin grounding web confirmado"}</StatusBadge>
                    </div>
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-ink">{summary || "Candidatos con fuente verificable, ordenados por evidencia técnica, precio, cobertura y riesgo."}</p>
                    {!grounded ? <p className="mt-2 text-xs leading-5 text-amber-700">Verifica manualmente URLs, existencia y disponibilidad. Esta ejecución pudo usar razonamiento del modelo sin búsqueda web.</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" onClick={() => setView("prepare")} variant="secondary">Ajustar búsqueda</Button>
                    <Button type="button" onClick={() => void runSourcing()} disabled={searching} variant="primary"><Search className="h-4 w-4" />Repetir</Button>
                  </div>
                </div>
              </ModuleSection>

              <ModuleSection className="p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_auto_auto] lg:items-center">
                  <label className="relative block min-w-0">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} className="app-input pl-9" placeholder="Filtrar empresa, país o tipo" />
                  </label>
                  <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:pb-0">
                    {([
                      ["todos", "Todos"], ["cobertura", "Cobertura total"], ["bajo_riesgo", "Riesgo bajo"], ["auditados", "Auditados"]
                    ] as [ResultFilter, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => setResultFilter(value)} className={`app-filter-pill whitespace-nowrap ${resultFilter === value ? "app-filter-pill-active" : "app-filter-pill-idle"}`}>{label}</button>)}
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <ListFilter className="h-4 w-4 text-brand" />
                    <select value={resultSort} onChange={(event) => setResultSort(event.target.value as ResultSort)} className="app-input h-10">
                      <option value="recomendados">Mejor balance</option>
                      <option value="cobertura">Mayor cobertura</option>
                      <option value="tecnico">Mejor evidencia técnica</option>
                      <option value="precio">Precio más verificable</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3 text-xs text-muted">Mostrando {visibleProviders.length} de {providers.length} candidatos con fuente web. &quot;No demostrado&quot; significa que todavía falta evidencia; no equivale a incumplimiento.</div>
              </ModuleSection>

              {visibleProviders.length && selectedProvider ? (
                <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(290px,0.36fr)_minmax(0,0.64fr)]">
                  <ModuleSection className="min-w-0 overflow-hidden p-0 xl:self-start">
                    <div className="border-b border-line px-4 py-3">
                      <div className="text-sm font-semibold text-ink">Candidatos</div>
                      <p className="mt-1 text-xs text-muted">Selecciona una empresa para revisar su evidencia.</p>
                    </div>
                    <div className="max-h-[680px] overflow-y-auto p-2">
                      {visibleProviders.map((provider, index) => {
                        const active = index === (expandedIndex ?? 0);
                        return (
                          <button key={`${provider.proveedor}-${provider.url}-${index}`} type="button" onClick={() => setExpandedIndex(index)} aria-current={active ? "true" : undefined} className={`app-provider-row w-full p-3 text-left ${active ? "app-provider-row-active" : ""}`}>
                            <div className="flex items-start gap-3">
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-xs font-bold text-ink">{index + 1}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-ink">{provider.proveedor || "Proveedor sin nombre"}</span>
                                <span className="mt-1 block truncate text-xs text-muted">{provider.pais_region || "Región no confirmada"} · {provider.tipo || "Tipo no confirmado"}</span>
                              </span>
                              <ChevronDown className={`mt-1 h-4 w-4 shrink-0 -rotate-90 text-muted transition-transform ${active ? "text-brand" : ""}`} />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
                              <StatusBadge tone={technicalTone(provider.estado_tecnico)}>{provider.estado_tecnico || "No demostrado"}</StatusBadge>
                              <StatusBadge tone={riskTone(provider.riesgo)}>Riesgo {provider.riesgo || "N/D"}</StatusBadge>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </ModuleSection>

                  <ModuleSection className="min-w-0 overflow-hidden p-0">
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-sm font-bold text-brand">{(expandedIndex ?? 0) + 1}</span>
                            <h3 className="min-w-0 break-words text-lg font-semibold text-ink">{selectedProvider.proveedor || "Proveedor sin nombre"}</h3>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <StatusBadge tone="neutral">{selectedProvider.pais_region || "Región no confirmada"}</StatusBadge>
                            <StatusBadge tone="neutral">{selectedProvider.tipo || "Tipo no confirmado"}</StatusBadge>
                            <StatusBadge tone={technicalTone(selectedProvider.estado_tecnico)}>Técnico: {selectedProvider.estado_tecnico || "No demostrado"}</StatusBadge>
                            <StatusBadge tone={priceTone(selectedProvider.estado_precio)}>{selectedProvider.estado_precio || "Sin precio verificable"}</StatusBadge>
                            <StatusBadge tone={riskTone(selectedProvider.riesgo)}>Riesgo: {selectedProvider.riesgo || "Validar"}</StatusBadge>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {selectedProvider.url ? <a href={selectedProvider.url} target="_blank" rel="noreferrer" className="app-btn app-btn-secondary inline-flex h-10 items-center justify-center gap-2 border px-3 text-sm font-semibold">Fuente <ExternalLink className="h-4 w-4" /></a> : null}
                          <Button type="button" onClick={() => sendProviderToEvaluation(selectedProvider)} variant="secondary"><CheckCircle2 className="h-4 w-4" />Evaluar oferta</Button>
                          <Button type="button" onClick={() => sendProviderToAudit(selectedProvider)} variant="primary"><ShieldCheck className="h-4 w-4" />Validar empresa</Button>
                        </div>
                      </div>
                    </div>

                    <div className="grid border-y border-line bg-slate-50 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-line">
                      {[
                        ["Prioridad", `${providerRankScore(selectedProvider, selectedItems.length)}/100`],
                        ["Cobertura", `${providerCoverage(selectedProvider)}/${selectedItems.length}`],
                        ["Evidencia", selectedProvider.nivel_evidencia || "Insuficiente"],
                        ["Decisión", selectedProvider.decision || "Validar"]
                      ].map(([label, value]) => <div key={label} className="border-t border-line px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 lg:border-t-0"><div className="text-xs font-semibold text-muted">{label}</div><div className="mt-1 text-sm font-bold text-ink">{value}</div></div>)}
                    </div>

                    <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-line">
                      <div className="p-4 sm:p-5"><div className="text-xs font-semibold uppercase text-muted">Por qué puede servir</div><p className="mt-2 text-sm leading-6 text-ink">{selectedProvider.evidencia || "Sin evidencia suficiente; validar fuente."}</p></div>
                      <div className="border-t border-line p-4 sm:p-5 lg:border-t-0"><div className="text-xs font-semibold uppercase text-muted">Condición comercial</div><p className="mt-2 text-sm leading-6 text-ink">{selectedProvider.precio_publicado || selectedProvider.estado_precio || "Sin precio verificable"}</p><p className="mt-2 text-xs leading-5 text-muted">Disponibilidad: {selectedProvider.disponibilidad || "No confirmada"} · Lead time: {selectedProvider.lead_time || "No confirmado"}</p></div>
                    </div>

                    <div className="border-t border-line p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div><div className="text-sm font-semibold text-ink">Comprobación técnica</div><p className="mt-1 text-xs text-muted">Evidencia observada para los requisitos seleccionados.</p></div>
                        <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted">{selectedProvider.requisitos_confirmados || 0}/{selectedProvider.requisitos_esperados || selectedProvider.requisitos_revisados || 0} confirmados</span><StatusBadge tone={technicalTone(selectedProvider.estado_tecnico)}>{selectedProvider.nivel_evidencia || "Evidencia insuficiente"}</StatusBadge></div>
                      </div>
                      {selectedProvider.verificaciones_tecnicas?.length ? (
                        <div className="mt-3 overflow-hidden rounded-lg border border-line">
                          {selectedProvider.verificaciones_tecnicas.map((check, checkIndex) => (
                            <div key={`${check.requisito}-${checkIndex}`} className="grid gap-2 border-t border-line bg-panel p-3 first:border-t-0 lg:grid-cols-[minmax(170px,0.8fr)_auto_minmax(240px,1.2fr)] lg:items-start">
                              <div className="text-sm font-semibold leading-5 text-ink">{check.requisito}</div>
                              <StatusBadge tone={technicalTone(check.estado)}>{check.estado}</StatusBadge>
                              <div className="min-w-0 text-sm leading-5 text-muted">{check.evidencia || "La fuente no muestra este dato."}{check.fuente ? <a className="ml-2 inline-flex items-center gap-1 font-semibold text-brand hover:underline" href={check.fuente} target="_blank" rel="noreferrer">Fuente <ExternalLink className="h-3.5 w-3.5" /></a> : null}</div>
                            </div>
                          ))}
                        </div>
                      ) : <p className="mt-3 text-sm leading-6 text-muted">No hay evidencia técnica desglosada. Este candidato no debe tratarse como confirmado.</p>}
                    </div>

                    <div className="grid border-t border-line bg-slate-50 lg:grid-cols-2 lg:divide-x lg:divide-line">
                      <div className="p-4 sm:p-5"><div className="text-xs font-semibold uppercase text-muted">Pendiente antes de cotizar</div><p className="mt-2 text-sm leading-6 text-ink">{selectedProvider.que_validar || "Confirmar ficha, precio, stock, lead time, garantía y trazabilidad de la empresa."}</p></div>
                      <div className="border-t border-line p-4 sm:p-5 lg:border-t-0"><div className="text-xs font-semibold uppercase text-muted">Auditoría corporativa</div>{loadingAudits ? <div className="mt-2 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Buscando antecedentes...</div> : selectedProviderAudit ? <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-lg font-semibold text-ink">{selectedProviderAudit.score_final ?? 0}/100</span><StatusBadge tone={riskTone(selectedProviderAudit.riesgo)}>Riesgo {selectedProviderAudit.riesgo || "N/D"}</StatusBadge><StatusBadge tone={decisionTone(selectedProviderAudit.decision)}>{selectedProviderAudit.decision || "Revisar"}</StatusBadge></div> : <p className="mt-2 text-sm leading-6 text-muted">Sin auditoría previa. Valida la empresa antes de solicitar cotización.</p>}</div>
                    </div>
                  </ModuleSection>
                </div>
              ) : (
                <ModuleSection><EmptyState icon={Target} title={providers.length ? "Ningún candidato coincide con el filtro" : "No hay candidatos"} copy={providers.length ? "Limpia el filtro o cambia el orden para volver a mostrar resultados." : "Vuelve a Preparar búsqueda y ajusta los renglones o la instrucción."} /></ModuleSection>
              )}

              {searchPlan.length ? (
                <details className="app-surface p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-ink">Cómo se construyó la búsqueda</summary>
                  <div className="mt-4 space-y-3">
                    {searchPlan.map((plan, index) => <div key={index} className="border-t border-line pt-3 first:border-0 first:pt-0"><div className="text-sm font-semibold text-ink">Renglón {plan.renglon || index + 1} · {plan.codigo_acp || "S/C"}</div><p className="mt-1 break-words text-xs leading-5 text-muted">{plan.queries?.join(" · ") || plan.query_base || "Plan no disponible"}</p></div>)}
                  </div>
                </details>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
