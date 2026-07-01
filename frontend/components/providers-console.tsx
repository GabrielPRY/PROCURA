"use client";

import {
  AlertTriangle,
  BrainCircuit,
  Bot,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  ListChecks,
  PackageSearch,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { asBool, asOptionalBool, cleanValue, getUserConfig, loadActiveRfqContext, loadLastRfq, type ActiveRfqItemContext, type RfqAnalysisResponse, type RfqItem } from "@/lib/rfq";
import { type AuthUser } from "@/lib/auth";
import { COMPANY_AUDIT_DRAFT_KEY, listCompanyAudits, type CompanyAuditDraft, type CompanyAuditListItem } from "@/lib/company-audit";
import type { ModuleId } from "@/lib/navigation";
import { searchProviders, type SourcingProvider, type SourcingSearchPlan } from "@/lib/sourcing";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type SearchScope = "renglon" | "todos";
type SourcingStrategy = "por_renglon" | "proveedor_integral";
type ChatRole = "user" | "assistant";
type SourcingTab = "buscar" | "ranking" | "validar";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

const starterPrompts = [
  "Busca 10 proveedores globales con mejor oportunidad de ahorro y bajo riesgo comercial.",
  "Prioriza fabricantes directos y distribuidores menos obvios. Alibaba puede servir si se valida bien.",
  "Busca alternativas tecnicamente compatibles, pero no asumas cumplimiento sin evidencia.",
  "Encuentra proveedores con stock o capacidad de cotizar rapido y condiciones Net 30 si es posible."
];

function itemLabel(item: RfqItem, index: number) {
  const renglon = cleanValue(item.renglon, String(index + 1));
  const code = cleanValue(item.codigo_articulo, "S/C");
  const desc = cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "Sin descripcion");
  return `Renglon ${renglon} | ${code} | ${desc.slice(0, 80)}`;
}

function queryFromItem(item?: RfqItem) {
  if (!item) return "";
  const parts = [
    cleanValue(item.termino_de_busqueda_corto, ""),
    cleanValue(item.marca_modelo_requerido, ""),
    cleanValue(item.codigo_articulo, ""),
    cleanValue(item.descripcion || item.ficha_tecnica_completa, "").slice(0, 160)
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(" ");
}

function sourceCards(query: string) {
  const encoded = encodeURIComponent(query || "industrial supplier");
  return [
    {
      label: "Google Global",
      type: "Abierto",
      hint: "Fabricantes, distribuidores, stockistas y resultados menos obvios.",
      href: `https://www.google.com/search?q=${encoded}+manufacturer+distributor+stock+price+datasheet`
    },
    {
      label: "Google exacto",
      type: "Preciso",
      hint: "Numero de parte o codigo como frase exacta.",
      href: `https://www.google.com/search?q=%22${encoded}%22+supplier+OR+distributor+OR+manufacturer`
    },
    {
      label: "Alibaba",
      type: "Marketplace B2B",
      hint: "Puede servir para precio agresivo. Validar empresa, producto, pagos y trazabilidad.",
      href: `https://www.alibaba.com/trade/search?SearchText=${encoded}`
    },
    {
      label: "Made-in-China",
      type: "Factory direct",
      hint: "Fabricantes directos y exportadores. Validar ficha tecnica y muestras.",
      href: `https://www.made-in-china.com/products-search/hot-china-products/${encoded}.html`
    },
    {
      label: "Global Sources",
      type: "Asia B2B",
      hint: "Proveedores y fabricantes globales. Revisar certificaciones y contacto.",
      href: `https://www.globalsources.com/search?query=${encoded}`
    },
    {
      label: "Thomasnet",
      type: "Industrial USA",
      hint: "Proveedores industriales, fabricantes y distribuidores en Norteamerica.",
      href: `https://www.thomasnet.com/search.html?cov=NA&what=${encoded}`
    },
    {
      label: "Octopart",
      type: "Componentes",
      hint: "Partes, datasheets, stock y distribuidores electronicos.",
      href: `https://octopart.com/search?q=${encoded}`
    },
    {
      label: "Europages",
      type: "Europa",
      hint: "Fabricantes y distribuidores europeos menos obvios.",
      href: `https://www.europages.com/en/search?q=${encoded}`
    }
  ];
}

function validationRows() {
  return [
    ["Cumplimiento tecnico", "Ficha tecnica, marca/modelo, numero de parte, equivalencia y certificaciones si aplican."],
    ["Oportunidad de ahorro", "Fabricante directo, stockista, excedente nuevo, distribuidor regional o marketplace B2B validado."],
    ["Empresa real", "Web propia o perfil B2B consistente, correo corporativo, telefono, direccion y actividad verificable."],
    ["Riesgo comercial", "Evitar pagos sin trazabilidad, dominios dudosos, datos inconsistentes o falta de evidencia tecnica."],
    ["Cotizacion usable", "Precio, moneda, stock, lead time, Incoterm, validez, garantia y Net 30 o superior cuando sea posible."]
  ];
}

function smartPromptForItem(item: RfqItem | undefined, scope: SearchScope, totalItems: number, strategy: SourcingStrategy) {
  if (!item && scope === "renglon") {
    return "Busca 10 proveedores globales utiles para el RFQ. Razona primero los requisitos tecnicos, luego busca candidatos reales y prioriza precio bajo con bajo riesgo comercial.";
  }
  if (scope === "todos") {
    const integral = strategy === "proveedor_integral";
    return [
      `Busca 10 proveedores globales utiles para los ${Math.min(totalItems, 5)} renglones principales del RFQ.`,
      integral
        ? "Prioridad maxima: encontrar proveedores integrales que puedan cotizar todos los renglones o la mayor cantidad posible en una sola solicitud."
        : "Prioriza el mejor proveedor por cada renglon, aunque sean proveedores distintos.",
      "Primero identifica familias tecnicas, codigos ACP, marcas/modelos, equivalencias permitidas y requisitos documentales.",
      "Luego busca proveedores reales a nivel global: fabricantes directos, distribuidores regionales, stockistas, excedentes nuevos y marketplaces B2B confiables.",
      "Rankea por cobertura de renglones, precio bajo, cumplimiento tecnico, evidencia trazable y bajo riesgo comercial. No inventes precios ni contactos."
    ].join(" ");
  }

  return [
    `Busca 10 proveedores globales para el renglon ${cleanValue(item?.renglon, "")}.`,
    `Codigo ACP: ${cleanValue(item?.codigo_articulo, "No especificado")}.`,
    `Descripcion tecnica: ${cleanValue(item?.ficha_tecnica_completa || item?.descripcion || item?.termino_de_busqueda_corto, "No especificado")}.`,
    `Marca/modelo requerido: ${cleanValue(item?.marca_modelo_requerido, "No especificado")}.`,
    `Acepta equivalente: ${asOptionalBool(item?.acepta_equivalente) === false ? "No, buscar exacto o autorizado" : "Si aplica, buscar equivalentes tecnicamente compatibles"}.`,
    `Requiere propuesta tecnica: ${asBool(item?.requiere_propuesta_tecnica) ? "Si" : "No especificado"}.`,
    `Requiere ficha/catalogo: ${asBool(item?.requiere_ficha_tecnica) ? "Si" : "No especificado"}.`,
    "Razona primero que producto se necesita, luego busca proveedores reales y rankea por cumplimiento tecnico, oportunidad de ahorro, riesgo y evidencia. Alibaba puede servir solo si el proveedor es trazable."
  ].join(" ");
}

function riskTone(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("bajo")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("alto")) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function savingTone(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("alta")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("baja")) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function decisionTone(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("recomendado")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("descartar")) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function auditDecisionTone(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("avanzar") || normalized.includes("aprob")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("descartar") || normalized.includes("bloquear")) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function domainFromUrl(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const withProtocol = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function normalizeCompanyName(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(inc|corp|corporation|co|company|llc|ltd|limited|s\.a\.?|sa|gmbh|group|international|intl)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatAuditDate(value?: string) {
  if (!value) return "Sin fecha";
  try {
    return new Intl.DateTimeFormat("es-PA", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ProvidersConsole({ user, onModuleChange }: { user: AuthUser; onModuleChange?: (moduleId: ModuleId) => void }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [scope, setScope] = useState<SearchScope>("renglon");
  const [sourcingStrategy, setSourcingStrategy] = useState<SourcingStrategy>("proveedor_integral");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [input, setInput] = useState("");
  const [depth, setDepth] = useState("Profunda");
  const [searching, setSearching] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Selecciona un renglon y presiona busqueda inteligente. Yo traduzco el RFQ a una estrategia de sourcing y rankeo proveedores por cumplimiento, ahorro y riesgo."
    }
  ]);
  const [summary, setSummary] = useState("");
  const [providers, setProviders] = useState<SourcingProvider[]>([]);
  const [engine, setEngine] = useState("");
  const [searchPlan, setSearchPlan] = useState<SourcingSearchPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [geminiSource, setGeminiSource] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [activeTab, setActiveTab] = useState<SourcingTab>("buscar");
  const [auditHistory, setAuditHistory] = useState<CompanyAuditListItem[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [activeRfqContext, setActiveRfqContext] = useState<ActiveRfqItemContext | null>(null);

  useEffect(() => {
    const savedRfq = loadLastRfq(user.username);
    const context = loadActiveRfqContext(user.username);
    setRfq(savedRfq);
    setActiveRfqContext(context?.target_module === "proveedores" ? context : null);
    if (savedRfq?.items?.length && context?.target_module === "proveedores") {
      const nextIndex = Math.min(Math.max(Number(context.item_index) || 0, 0), savedRfq.items.length - 1);
      setSelectedIndex(nextIndex);
      setScope("renglon");
      setInput(
        `Busca 10 proveedores globales para el renglon ${context.renglon || nextIndex + 1}. Prioriza precio bajo, cumplimiento tecnico, proveedor real y bajo riesgo comercial.`
      );
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
  const selectedItem = items[selectedIndex];
  const selectedQuery = queryFromItem(selectedItem);
  const allQueries = items.map(queryFromItem).filter(Boolean);
  const activeQuery = scope === "todos" ? allQueries.slice(0, 5).join(" | ") : selectedQuery;
  const richLinks = sourceCards(activeQuery || "industrial supplier");
  const rfqNumber = cleanValue(rfq?.condiciones_generales?.numero_licitacion, "Sin RFQ");
  const selectedRenglon = selectedItem ? cleanValue(selectedItem.renglon, String(selectedIndex + 1)) : "N/D";
  const selectedCode = selectedItem ? cleanValue(selectedItem.codigo_articulo, "S/C") : "S/C";
  const selectedDescription = selectedItem
    ? cleanValue(selectedItem.termino_de_busqueda_corto || selectedItem.descripcion || selectedItem.ficha_tecnica_completa, "Sin descripcion")
    : "Analiza o abre un RFQ para activar el contexto tecnico.";

  useEffect(() => {
    if (!providers.length) {
      setAuditHistory([]);
      return;
    }

    let mounted = true;
    setLoadingAudits(true);
    listCompanyAudits({ limit: 300 })
      .then((response) => {
        if (mounted) setAuditHistory(response.audits || []);
      })
      .catch(() => {
        if (mounted) setAuditHistory([]);
      })
      .finally(() => {
        if (mounted) setLoadingAudits(false);
      });

    return () => {
      mounted = false;
    };
  }, [providers.length]);

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
      evidencia_tecnica: cleanValue(item.evidencia_tecnica, "")
    };
  }

  function sendProviderToAudit(provider: SourcingProvider) {
    const previousAudit = auditForProvider(provider);
    const contextParts = [
      `RFQ: ${rfqNumber}`,
      provider.renglon ? `Renglon: ${provider.renglon}` : "",
      activeQuery ? `Busqueda tecnica: ${activeQuery}` : "",
      provider.evidencia ? `Evidencia sourcing: ${provider.evidencia}` : "",
      provider.que_validar ? `Validar: ${provider.que_validar}` : ""
    ].filter(Boolean);
    const draft: CompanyAuditDraft = {
      company_name: provider.proveedor || "",
      website: provider.url || "",
      country: provider.pais_region || "",
      product_context: contextParts.join("\n"),
      notes: [
        provider.tipo ? `Tipo sugerido: ${provider.tipo}` : "",
        provider.riesgo ? `Riesgo preliminar sourcing: ${provider.riesgo}` : "",
        provider.probabilidad_buen_precio ? `Oportunidad de ahorro: ${provider.probabilidad_buen_precio}` : "",
        provider.decision ? `Decision preliminar: ${provider.decision}` : "",
        previousAudit ? `Auditoria previa: ${previousAudit.score_final}/100 | ${previousAudit.riesgo || "Sin riesgo"} | ${previousAudit.decision || "Sin decision"}` : ""
      ].filter(Boolean).join("\n"),
      source: "proveedores",
      created_at: new Date().toISOString()
    };
    try {
      window.localStorage.setItem(COMPANY_AUDIT_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Si localStorage no esta disponible, solo cambiamos de modulo.
    }
    onModuleChange?.("auditor_empresas");
  }

  function auditForProvider(provider: SourcingProvider) {
    const providerDomain = domainFromUrl(provider.url);
    const providerName = normalizeCompanyName(provider.proveedor);

    return auditHistory.find((audit) => {
      const auditDomain = String(audit.domain || domainFromUrl(audit.website)).toLowerCase();
      if (providerDomain && auditDomain && providerDomain === auditDomain) return true;

      const auditName = normalizeCompanyName(audit.company_name);
      if (!providerName || !auditName) return false;
      return providerName === auditName || providerName.includes(auditName) || auditName.includes(providerName);
    });
  }

  async function runSourcing(prompt: string) {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || searching) return;
    setInput("");
    setError(null);
    setSearching(true);
    setSummary("");
    setProviders([]);
    setEngine("");
    setSearchPlan([]);
    setMessages((current) => [...current, { role: "user", content: cleanPrompt }]);

    try {
      const selectedItems = scope === "todos" ? items : selectedItem ? [selectedItem] : [];
      const response = await searchProviders({
        username: user.username,
        items: selectedItems.map(itemPayload),
        custom_prompt: cleanPrompt,
        depth,
        target_count: 10,
        sourcing_strategy: scope === "todos" ? sourcingStrategy : "por_renglon"
      });

      setSummary(response.resumen || "");
      setProviders(response.proveedores || []);
      setEngine(response.engine || (response.evidence_count ? "web_search" : ""));
      setSearchPlan(response.search_plan || []);

      const providerCount = response.proveedores?.length || 0;
      const answer = providerCount
        ? sourcingStrategy === "proveedor_integral" && scope === "todos"
          ? `Encontre ${providerCount} candidatos. Los ordene dando prioridad a proveedores que puedan cubrir varios renglones o todo el RFQ.`
          : `Encontre ${providerCount} candidatos. Los ordene por match tecnico, oportunidad de ahorro y riesgo comercial. Revisa el panel de ranking antes de cotizar.`
        : "Gemini no genero candidatos suficientes con evidencia util. Te deje fuentes abiertas y criterios de validacion para continuar manualmente.";
      setMessages((current) => [...current, { role: "assistant", content: answer }]);
      setActiveTab(providerCount ? "ranking" : "validar");
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo completar el sourcing.";
      setError(message);
      setMessages((current) => [...current, { role: "assistant", content: message }]);
    } finally {
      setSearching(false);
    }
  }

  async function runSmartSourcing() {
    const prompt = [
      smartPromptForItem(selectedItem, scope, items.length, sourcingStrategy),
      input.trim() ? `Instruccion adicional del usuario: ${input.trim()}` : ""
    ].filter(Boolean).join("\n\n");
    await runSourcing(prompt);
  }

  const tabs = [
    {
      id: "buscar" as const,
      label: "Buscar",
      detail: scope === "todos" ? "Todos los renglones" : selectedItem ? `Renglon ${cleanValue(selectedItem.renglon, String(selectedIndex + 1))}` : "Definir busqueda"
    },
    {
      id: "ranking" as const,
      label: "Ranking",
      detail: providers.length ? `${providers.length} candidatos` : "Sin resultados"
    },
    {
      id: "validar" as const,
      label: "Validar",
      detail: "Fuentes y checklist"
    }
  ];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Sourcing global asistido"
          title="Proveedores"
          copy="Busca 10 proveedores utiles por renglon o por RFQ completo. La prioridad es precio bajo, cumplimiento tecnico, empresa real y riesgo comercial controlado."
          actions={
            <>
              <StatusBadge tone={loadingConfig ? "warn" : hasGeminiKey ? "ok" : "warn"}>
                {loadingConfig ? "Verificando IA" : hasGeminiKey ? "IA lista" : "IA pendiente"}
              </StatusBadge>
              <Button onClick={() => void runSmartSourcing()} disabled={searching || !items.length} variant="primary" size="lg">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar 10 proveedores
              </Button>
            </>
          }
        />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">RFQ activo</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">{rfqNumber}</div>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Renglon / Codigo</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">{selectedRenglon} | {selectedCode}</div>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Producto buscado</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">{selectedDescription}</div>
          </div>
        </div>
      </ModuleSection>

      <ModuleSection>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 ${hasGeminiKey ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              {hasGeminiKey ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {loadingConfig ? "Verificando IA" : hasGeminiKey ? "IA lista" : "IA pendiente"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-800">
              <Globe2 className="h-3.5 w-3.5" />
              Alcance global
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-800">
              <ShieldCheck className="h-3.5 w-3.5" />
              Validar empresa antes de cotizar
            </span>
          </div>
          {activeRfqContext ? (
            <div className="min-w-0 rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs text-slate-700 lg:max-w-[48%]">
              <span className="font-semibold text-slate-900">Desde RFQ:</span>{" "}
              <span className="inline-block max-w-full truncate align-bottom">
                Renglon {activeRfqContext.renglon || activeRfqContext.item_index + 1} | {activeRfqContext.codigo_acp || "S/C"} | {activeRfqContext.descripcion || "Sin descripcion"}
              </span>
            </div>
          ) : null}
        </div>
      </ModuleSection>

      <ModuleSection className="p-2">
        <div className="grid gap-2 md:grid-cols-3">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            const disabled = tab.id === "ranking" && !providers.length && !searching;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => !disabled && setActiveTab(tab.id)}
                disabled={disabled}
                className={`rounded-lg border px-4 py-3 text-left transition ${
                  active
                    ? "border-blue-200 bg-blue-50 text-brand"
                    : disabled
                      ? "border-transparent bg-white text-slate-400"
                      : "border-transparent bg-white text-slate-700 hover:border-blue-100 hover:bg-slate-50"
                }`}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{tab.detail}</span>
              </button>
            );
          })}
        </div>
      </ModuleSection>

      {!items.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Analiza primero un RFQ. El chat necesita la matriz tecnica para buscar proveedores que realmente cumplan.
        </section>
      ) : (
        <>
          {(activeTab === "buscar" || activeTab === "ranking") ? (
          <section className={`grid gap-4 ${activeTab === "buscar" ? "xl:grid-cols-[0.95fr_1.05fr]" : "xl:grid-cols-1"}`}>
            {activeTab === "buscar" ? (
            <ModuleSection className="overflow-hidden p-0">
              <div className="border-b border-line p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Busqueda inteligente</div>
                    <p className="mt-1 text-xs text-muted">El sistema interpreta el RFQ y arma la estrategia. El texto adicional es opcional.</p>
                  </div>
                  <select
                    value={depth}
                    onChange={(event) => setDepth(event.target.value)}
                    className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="Profunda">Busqueda profunda</option>
                    <option value="Rapida">Busqueda rapida</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 border-b border-line bg-slate-50/70 p-4 lg:grid-cols-[0.42fr_0.58fr_1fr]">
                <label className="grid gap-2 text-sm font-semibold text-slate-800">
                  Alcance
                  <select
                    value={scope}
                    onChange={(event) => setScope(event.target.value as SearchScope)}
                    className="app-input"
                  >
                    <option value="renglon">Un renglon</option>
                    <option value="todos">Todos los renglones</option>
                  </select>
                </label>
                {scope === "renglon" ? (
                  <label className="grid gap-2 text-sm font-semibold text-slate-800 lg:col-span-2">
                    Renglon base
                    <select
                      value={selectedIndex}
                      onChange={(event) => setSelectedIndex(Number(event.target.value))}
                      className="app-input"
                    >
                      {items.map((item, index) => (
                        <option key={`${item.renglon}-${index}`} value={index}>
                          {itemLabel(item, index)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="grid gap-2 text-sm font-semibold text-slate-800">
                      Estrategia
                      <select
                        value={sourcingStrategy}
                        onChange={(event) => setSourcingStrategy(event.target.value as SourcingStrategy)}
                        className="app-input"
                      >
                        <option value="proveedor_integral">Priorizar proveedor integral</option>
                        <option value="por_renglon">Mejor proveedor por renglon</option>
                      </select>
                    </label>
                    <div className="rounded-lg border border-line bg-white p-3 text-sm text-slate-700">
                      {sourcingStrategy === "proveedor_integral"
                        ? "Se buscaran proveedores capaces de cubrir todos o la mayor cantidad de renglones del RFQ."
                        : "Se usaran hasta 5 renglones para encontrar los mejores candidatos por item."}
                    </div>
                  </>
                )}
              </div>

                <div className="border-b border-line bg-white p-4">
                  <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
                        <BrainCircuit className="h-4 w-4" />
                        Estrategia automatica
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg border border-blue-100 bg-white/80 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">1. Interpretar</div>
                          <div className="mt-1 text-xs leading-5 text-blue-900">Producto, codigo, marca, equivalencias y documentos.</div>
                        </div>
                        <div className="rounded-lg border border-blue-100 bg-white/80 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">2. Buscar</div>
                          <div className="mt-1 text-xs leading-5 text-blue-900">Fabricantes, stockistas, distribuidores y B2B global.</div>
                        </div>
                        <div className="rounded-lg border border-blue-100 bg-white/80 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">3. Rankear</div>
                          <div className="mt-1 text-xs leading-5 text-blue-900">Cumplimiento, oportunidad de ahorro y riesgo comercial.</div>
                        </div>
                      </div>
                    </div>
                    <Button type="button" onClick={() => void runSmartSourcing()} disabled={searching || !items.length} variant="primary" className="min-h-28 py-4">
                      {searching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                      Buscar 10 proveedores
                    </Button>
                  </div>
                </div>

                <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    {message.role === "assistant" ? (
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-brand">
                        <Bot className="h-4 w-4" />
                      </div>
                    ) : null}
                    <div
                      className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                        message.role === "user"
                          ? "bg-brand text-white"
                          : "border border-line bg-slate-50 text-slate-800"
                      }`}
                    >
                      {message.content}
                    </div>
                    {message.role === "user" ? (
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600">
                        <UserRound className="h-4 w-4" />
                      </div>
                    ) : null}
                  </div>
                ))}
                {searching ? (
                  <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Buscando evidencia, descartando ruido y rankeando proveedores...
                  </div>
                ) : null}
              </div>

                <div className="border-t border-line p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="app-btn-mini"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    <ListChecks className="h-3.5 w-3.5" />
                    Ajuste opcional
                  </div>
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    rows={3}
                    className="min-h-20 flex-1 resize-none rounded-xl border border-line bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                    placeholder="Ej: prioriza fabricantes directos asiaticos, distribuidores con stock en USA, Net 30, o descarta usados/refurbished."
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void runSmartSourcing()} disabled={searching || !items.length} variant="primary" size="lg">
                      {searching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                      Buscar con RFQ
                    </Button>
                  <Button type="button" onClick={() => runSourcing(input)} disabled={searching || !input.trim()} variant="secondary" size="lg" title="Buscar solo con la instruccion escrita">
                    <Send className="h-5 w-5" />
                    Solo instruccion
                  </Button>
                  </div>
                </div>
              </div>
            </ModuleSection>
            ) : null}

            <div className="space-y-4">
              <div className="app-card p-5 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Ranking de proveedores</div>
                    <p className="mt-1 text-sm text-muted">Ordenado por match tecnico, oportunidad de ahorro y riesgo comercial.</p>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    engine === "manual_sources"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : providers.length
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-blue-200 bg-blue-50 text-blue-700"
                  }`}>
                    {engine === "manual_sources" ? "Fuentes abiertas" : providers.length ? `${providers.length} candidatos` : "Sin ranking aun"}
                  </div>
                </div>

                {error ? (
                  <div className="mt-4 flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </div>
                ) : null}

                {summary ? (
                  <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                    {summary}
                  </div>
                ) : null}

                <div className="mt-4 space-y-3">
                  {providers.map((provider, index) => {
                    const previousAudit = auditForProvider(provider);
                    const previousAuditBlocks = String(previousAudit?.decision || "").toLowerCase().includes("descartar");
                    return (
                    <div key={`${provider.proveedor}-${index}`} className="app-workflow-card p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-brand">Proveedor #{index + 1}</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{provider.proveedor || "Proveedor sin nombre"}</div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                            <span className="rounded-full border border-line bg-slate-50 px-2.5 py-1 text-slate-700">{provider.pais_region || "Region no confirmada"}</span>
                            <span className="rounded-full border border-line bg-slate-50 px-2.5 py-1 text-slate-700">{provider.tipo || "Tipo no confirmado"}</span>
                            {provider.renglon ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700">Renglon {provider.renglon}</span> : null}
                            {provider.cobertura_renglones ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">Cubre {provider.cobertura_renglones} renglon(es)</span> : null}
                          </div>
                          {loadingAudits ? (
                            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Revisando auditorias previas
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" onClick={() => sendProviderToAudit(provider)} variant="primary" size="sm">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Auditar
                          </Button>
                          {provider.url ? (
                            <a
                              href={provider.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-brand"
                            >
                              Fuente
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      {previousAudit ? (
                        <div className={`mt-4 rounded-xl border p-3 ${previousAuditBlocks ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <div className={`text-xs font-semibold uppercase tracking-wide ${previousAuditBlocks ? "text-rose-700" : "text-emerald-700"}`}>
                                Auditoria previa encontrada
                              </div>
                              <div className={`mt-1 text-sm leading-6 ${previousAuditBlocks ? "text-rose-800" : "text-emerald-800"}`}>
                                {previousAudit.domain || domainFromUrl(previousAudit.website) || previousAudit.company_name} | {formatAuditDate(previousAudit.created_at)}
                              </div>
                            </div>
                            <div className="grid min-w-0 gap-2 sm:grid-cols-3 lg:w-full lg:max-w-[460px]">
                              <div className="rounded-lg border border-white/70 bg-white/70 p-2">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Score</div>
                                <div className="mt-1 text-sm font-semibold text-slate-900">{previousAudit.score_final ?? 0}/100</div>
                              </div>
                              <div className={`rounded-lg border p-2 ${riskTone(previousAudit.riesgo)}`}>
                                <div className="text-[11px] font-semibold uppercase tracking-wide">Riesgo</div>
                                <div className="mt-1 text-sm font-semibold">{previousAudit.riesgo || "Sin clasificar"}</div>
                              </div>
                              <div className={`rounded-lg border p-2 ${auditDecisionTone(previousAudit.decision)}`}>
                                <div className="text-[11px] font-semibold uppercase tracking-wide">Decision</div>
                                <div className="mt-1 text-sm font-semibold">{previousAudit.decision || "Revisar"}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-2 sm:grid-cols-4">
                        <div className="app-data-card">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Match tecnico</div>
                          <div className="mt-1 text-xl font-semibold text-slate-900">{provider.match_tecnico ?? 0}%</div>
                        </div>
                        <div className={`rounded-lg border p-3 ${savingTone(provider.probabilidad_buen_precio)}`}>
                          <div className="text-xs font-semibold uppercase tracking-wide">Ahorro</div>
                          <div className="mt-1 text-sm font-semibold">{provider.probabilidad_buen_precio || "Media"}</div>
                        </div>
                        <div className={`rounded-lg border p-3 ${riskTone(provider.riesgo)}`}>
                          <div className="text-xs font-semibold uppercase tracking-wide">Riesgo</div>
                          <div className="mt-1 text-sm font-semibold">{provider.riesgo || "Medio"}</div>
                        </div>
                        <div className={`rounded-lg border p-3 ${decisionTone(provider.decision)}`}>
                          <div className="text-xs font-semibold uppercase tracking-wide">Decision</div>
                          <div className="mt-1 text-sm font-semibold">{provider.decision || "Validar"}</div>
                        </div>
                      </div>
                      {provider.cobertura_detalle || provider.renglones_cubiertos?.length ? (
                        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Cobertura del RFQ</div>
                          <div className="mt-1 text-sm leading-6 text-emerald-900">
                            {provider.cobertura_detalle || `Renglones cubiertos: ${provider.renglones_cubiertos?.join(", ")}`}
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div className="app-data-card">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Evidencia</div>
                          <div className="mt-1 text-sm leading-6 text-slate-700">{provider.evidencia || "Sin evidencia resumida."}</div>
                        </div>
                        <div className="app-data-card">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Que validar</div>
                          <div className="mt-1 text-sm leading-6 text-slate-700">
                            {provider.que_validar || "Pedir ficha tecnica, precio, stock, lead time, Incoterm, validez y datos corporativos."}
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                  {!providers.length ? (
                    <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                      <div>
                        <PackageSearch className="mx-auto h-8 w-8 text-brand" />
                        <div className="mt-3 text-sm font-semibold text-slate-900">Sin ranking todavia</div>
                        <p className="mt-1 max-w-md text-sm leading-6 text-muted">
                          Escribe una instruccion en el chat. El resultado aparecera aqui con auditoria previa, evidencia y acciones.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="app-card p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Criterios obligatorios
                </div>
                <div className="mt-3 grid gap-2">
                  {validationRows().map(([title, copy]) => (
                    <div key={title} className="app-data-card">
                      <div className="text-sm font-semibold text-slate-900">{title}</div>
                      <div className="mt-1 text-xs leading-5 text-muted">{copy}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          ) : null}

          {activeTab === "validar" ? (
          <section className="app-card p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Fuentes y plan de busqueda</div>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-muted">{activeQuery || "No hay descripcion tecnica suficiente."}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                <Target className="h-3.5 w-3.5 text-brand" />
                No limitado a un portal
              </div>
            </div>

            {searchPlan.length > 0 ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {searchPlan.map((plan, index) => (
                  <div key={`${plan.renglon}-${index}`} className="rounded-xl border border-line bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Renglon {plan.renglon || index + 1}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{plan.query_base || "Sin query base"}</div>
                    <div className="mt-3 space-y-2">
                      {(plan.queries || []).slice(0, 6).map((query) => (
                        <div key={query} className="rounded-md bg-white px-3 py-2 text-xs leading-5 text-slate-700">{query}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {richLinks.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-line bg-white p-3 text-sm transition hover:border-blue-300 hover:shadow-sm"
                >
                  <span className="flex items-center justify-between gap-3 font-semibold text-slate-900">
                    <span className="inline-flex items-center gap-2">
                      <Globe2 className="h-4 w-4 text-brand" />
                      {item.label}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted" />
                  </span>
                  <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{item.type}</span>
                  <p className="mt-2 text-xs leading-5 text-muted">{item.hint}</p>
                </a>
              ))}
            </div>
          </section>
          ) : null}
        </>
      )}
    </div>
  );
}






