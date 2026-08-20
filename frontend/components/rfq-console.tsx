"use client";

import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, FileText, Loader2, Mail, PackageSearch, ShieldAlert, Truck, UploadCloud } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { analyzeRfq, asBool, asOptionalBool, cleanValue, getUserConfig, loadLastRfq, saveActiveRfqContext, saveLastRfq, type RfqAnalysisResponse, type RfqItem } from "@/lib/rfq";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { saveWorkspace } from "@/lib/workspaces";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ModuleId } from "@/lib/navigation";

type DetailFlag = {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
};

type RfqTab = "entrada" | "resumen" | "renglones";

function boolLabel(value: unknown) {
  const parsed = asOptionalBool(value);
  if (parsed === true) return "Si";
  if (parsed === false) return "No";
  return "No determinado";
}

function flagTone(flag: DetailFlag["tone"]) {
  if (flag === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (flag === "warn") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getCg(cg: Record<string, unknown>, keys: string[], fallback = "No especificado") {
  for (const key of keys) {
    const value = cleanValue(cg[key], "");
    if (value) return value;
  }
  return fallback;
}

function localPresenceDecision(cg: Record<string, unknown>) {
  const presence = asOptionalBool(cg.requiere_presencia_local);
  const evidence = cleanValue(cg.evidencia_presencia_local, "");
  if (presence === true) {
    return {
      label: "Si",
      company: "Participar con EP",
      note: evidence || "El pliego exige presencia o empresa local.",
      tone: "warn" as const
    };
  }
  if (presence === false) {
    return {
      label: "No",
      company: "Participar con Proyelec",
      note: evidence || "El pliego no exige presencia local.",
      tone: "ok" as const
    };
  }
  return {
    label: "Validar",
    company: "Validar empresa",
    note: evidence || "No hay evidencia concluyente en los documentos.",
    tone: "warn" as const
  };
}

function decisionTone(tone: "ok" | "warn") {
  return tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800";
}

function riskTone(risk: string) {
  const normalized = risk.toLowerCase();
  if (normalized === "alto") return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized === "medio") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function itemLabel(item: RfqItem, index: number) {
  const renglon = cleanValue(item.renglon, String(index + 1));
  const code = cleanValue(item.codigo_articulo, "S/C");
  const desc = cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "Sin descripción");
  return `Renglón ${renglon} | ${code} | ${desc.slice(0, 72)}`;
}

function isValidAcpCode(value: unknown) {
  return /^[A-Z]{3}-[A-Z]{3}-\d{5}$/.test(cleanValue(value, "").trim().toUpperCase());
}

export function RfqConsole({ user, onModuleChange }: { user: AuthUser; onModuleChange?: (moduleId: ModuleId) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [geminiKey, setGeminiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [geminiSource, setGeminiSource] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progressStep, setProgressStep] = useState(0); // 0=idle,1=enviando,2=analizando,3=extrayendo,4=guardando
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [result, setResult] = useState<RfqAnalysisResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"simple" | "advanced">("simple");
  const [activeTab, setActiveTab] = useState<RfqTab>("entrada");

  useEffect(() => {
    const saved = loadLastRfq(user.username);
    if (saved) {
      setResult(saved);
      setSelectedIndex(0);
      setActiveTab("resumen");
    }
  }, [user.username]);

  useEffect(() => {
    let mounted = true;
    setLoadingConfig(true);
    getUserConfig(user.username)
      .then((config) => {
        if (!mounted) return;
        const key = config.gemini_key || "";
        setGeminiKey(key);
        setHasStoredKey(Boolean(config.has_gemini_key || key));
        setGeminiSource(config.gemini_source || "");
      })
      .catch(() => {
        if (mounted) setHasStoredKey(false);
      })
      .finally(() => {
        if (mounted) setLoadingConfig(false);
      });
    return () => {
      mounted = false;
    };
  }, [user.username]);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files || []);
    if (!nextFiles.length) return;
    // Confirm before clearing an existing analysis
    if (result && !window.confirm("Ya hay un análisis cargado. ¿Cargar nuevos documentos y reemplazarlo?")) {
      // Reset the input so the same files can be selected again if needed
      event.target.value = "";
      return;
    }
    setFiles(nextFiles);
    setResult(null);
    setSelectedIndex(0);
    setActiveTab("entrada");
    setError(null);
    setSaveNotice(null);
  }

  async function handleAnalyze() {
    setError(null);
    setSaveNotice(null);
    setProgressStep(0);
    if (!files.length) {
      setError("Sube al menos un PDF del pliego o anexo.");
      return;
    }
    if (!geminiKey.trim() && !hasStoredKey) {
      setError("Falta Gemini API Key. Configurala en Admin, en el perfil del usuario o pega una temporal aqui.");
      return;
    }

    setProcessing(true);
    setProgressStep(1); // Enviando documentos
    try {
      // Small delay to let the UI update before the heavy request
      await new Promise((resolve) => globalThis.setTimeout(resolve, 120));
      setProgressStep(2); // Analizando con IA
      const response = await analyzeRfq({
        files,
        geminiKey: geminiKey.trim(),
        username: user.username,
        role: normalizeRole(user.role)
      });
      setProgressStep(3); // Extrayendo renglones
      setResult(response);
      saveLastRfq(user.username, response);
      const responseCg = (response.condiciones_generales || {}) as Record<string, unknown>;
      const licitacion = cleanValue(responseCg.numero_licitacion || responseCg.licitacion, "");
      setProgressStep(4); // Guardando workspace
      try {
        const saved = await saveWorkspace({
          username: user.username,
          licitacion,
          data: (response.items || []) as Array<Record<string, unknown>>,
          condiciones_generales: responseCg
        });
        setSaveNotice(`Guardado en Supabase como workspace ${saved.licitacion}.`);
      } catch (saveErr) {
        setSaveNotice(saveErr instanceof Error ? `Análisis listo, pero no se pudo guardar en Supabase: ${saveErr.message}` : "Análisis listo, pero no se pudo guardar en Supabase.");
      }
      setSelectedIndex(0);
      setActiveTab("resumen");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo procesar el RFQ.");
    } finally {
      setProcessing(false);
      setProgressStep(0);
    }
  }

  const cg = (result?.condiciones_generales || {}) as Record<string, unknown>;
  const items = useMemo(() => result?.items || [], [result]);
  const selectedItem = items[selectedIndex];
  const presenceDecision = localPresenceDecision(cg);
  const validCodeCount = items.filter((item) => isValidAcpCode(item.codigo_articulo)).length;
  const proposalCount = items.filter((item) => asBool(item.requiere_propuesta_tecnica)).length;
  const fichaCount = items.filter((item) => asBool(item.requiere_ficha_tecnica)).length;
  const marcaCount = items.filter((item) => cleanValue(item.marca_modelo_requerido, "")).length;
  const obsolCount = items.filter((item) => asBool(item.posible_obsolescencia)).length;
  const contactName = getCg(cg, ["persona_encargada_licitacion", "persona_encargada", "agente_de_compras"], "");
  const contactEmail = getCg(cg, ["correo_encargado_licitacion", "correo_encargado", "correo_contacto"], "");
  const contactPhone = getCg(cg, ["telefono_encargado_licitacion", "telefono_encargado", "telefono_contacto"], "");
  const contactCount = [contactName, contactEmail, contactPhone].filter(Boolean).length;
  const risk = getCg(cg, ["riesgo_tecnico_global"], "Bajo");
  const technicalAttention = risk.toLowerCase() === "alto" ? "Alta" : risk.toLowerCase() === "medio" ? "Media" : "Baja";
  const proposalGlobal = getCg(cg, ["propuesta_tecnica_requerida"], "No especificado en los documentos adjuntos");
  const rfqNumber = getCg(cg, ["numero_licitacion", "licitacion", "rfq_id"], "");
  const proposalLines = Array.isArray(cg.propuesta_tecnica_aplica_renglones)
    ? (cg.propuesta_tecnica_aplica_renglones as unknown[]).map((value) => cleanValue(value, "")).filter(Boolean).join(", ")
    : "";

  const metrics = [
    ["Renglones", String(items.length)],
    ["Propuesta técnica", String(proposalCount)],
    ["Ficha / catálogo", String(fichaCount)],
    ["Marca/modelo", String(marcaCount)],
    ["Códigos ACP", `${validCodeCount}/${items.length}`],
    ["Atención técnica", technicalAttention]
  ];

  const decisionStats = [
    ["Presencia local", presenceDecision.label],
    ["Atención técnica", technicalAttention],
    ["Propuesta técnica", proposalCount ? `Preparar en ${proposalCount} renglón(es)` : "No detectada"],
    ["Ficha o catálogo", fichaCount ? `Preparar en ${fichaCount} renglón(es)` : "No solicitado aparte"]
  ];

  const generalCards = [
    ["N.º de licitación", getCg(cg, ["numero_licitacion", "licitacion", "rfq_id"])],
    ["Garantía", getCg(cg, ["garantia_exigida", "garantia", "garantias", "garantia_requerida"])],
    ["Lugar de entrega", getCg(cg, ["lugar_de_entrega", "lugar_entrega", "entrega"])],
    ["Tiempo de entrega", getCg(cg, ["tiempo_de_entrega_global", "tiempo_entrega", "plazo_entrega", "lead_time"])],
    ["Propuesta técnica", proposalLines ? `${proposalGlobal} (${proposalLines})` : proposalGlobal],
    ["Validez de la oferta", getCg(cg, ["validez_de_la_oferta", "validez_oferta", "validez"])],
    ["Encargado ACP", getCg(cg, ["persona_encargada_licitacion", "persona_encargada", "contacto_acp", "encargado_acp", "encargado"])],
    ["Correo", getCg(cg, ["correo_encargado_licitacion", "correo_acp", "email_acp", "correo"])],
    ["Teléfono", getCg(cg, ["telefono_encargado_licitacion", "telefono_acp", "telefono"])],
    ["Presencia local", presenceDecision.label],
    ["Empresa sugerida", presenceDecision.company]
  ];

  const simpleGeneralCards = [
    ["N.º de licitación", getCg(cg, ["numero_licitacion", "licitacion", "rfq_id"])],
    ["Garantía", getCg(cg, ["garantia_exigida", "garantia", "garantias", "garantia_requerida"])],
    ["Tiempo de entrega", getCg(cg, ["tiempo_de_entrega_global", "tiempo_entrega", "plazo_entrega", "lead_time"])],
    ["Lugar de entrega", getCg(cg, ["lugar_de_entrega", "lugar_entrega", "entrega"])],
    ["Contacto ACP", contactName || "No especificado"],
    ["Correo ACP", contactEmail || "No especificado"]
  ];

  function openModuleFromItem(moduleId: ModuleId) {
    if (!selectedItem) return;
    saveActiveRfqContext(user.username, {
      created_at: new Date().toISOString(),
      target_module: moduleId,
      licitacion: rfqNumber,
      item_index: selectedIndex,
      renglon: cleanValue(selectedItem.renglon, ""),
      codigo_acp: cleanValue(selectedItem.codigo_articulo, ""),
      descripcion: cleanValue(selectedItem.ficha_tecnica_completa || selectedItem.descripcion || selectedItem.termino_de_busqueda_corto, ""),
      cantidad: cleanValue(selectedItem.cantidad, ""),
      unidad: cleanValue(selectedItem.unidad_de_medida || selectedItem.unidad, ""),
      requiere_propuesta_tecnica: asBool(selectedItem.requiere_propuesta_tecnica),
      requiere_ficha_tecnica: asBool(selectedItem.requiere_ficha_tecnica),
      acepta_equivalente: asOptionalBool(selectedItem.acepta_equivalente),
      marca_modelo_requerido: cleanValue(selectedItem.marca_modelo_requerido, ""),
      evidencia_tecnica: cleanValue(selectedItem.evidencia_tecnica, ""),
      riesgo_tecnico_global: risk,
      propuesta_tecnica_requerida: proposalGlobal,
      presencia_local: presenceDecision.label,
      empresa_sugerida: presenceDecision.company
    });
    onModuleChange?.(moduleId);
  }

  const analysisState: DetailFlag[] = result
    ? [
        {
          label: "Pliego leído",
          value: getCg(cg, ["numero_licitacion"], "Número no especificado"),
          tone: getCg(cg, ["numero_licitacion"], "") ? "ok" : "warn"
        },
        {
          label: "Códigos ACP",
          value: items.length ? `${validCodeCount}/${items.length} validados` : "Sin renglones",
          tone: items.length && validCodeCount === items.length ? "ok" : "warn"
        },
        {
          label: "Propuesta técnica",
          value: proposalGlobal,
          tone: proposalGlobal.toLowerCase().startsWith("si") ? "ok" : "neutral"
        },
        {
          label: "Contacto ACP",
          value: `${contactCount}/3 datos detectados`,
          tone: contactCount >= 2 ? "ok" : "warn"
        },
        {
          label: "Empresa sugerida",
          value: presenceDecision.company,
          tone: presenceDecision.tone
        },
        {
          label: "Atención técnica",
          value: technicalAttention,
          tone: risk.toLowerCase() === "alto" || risk.toLowerCase() === "medio" ? "warn" : "ok"
        }
      ]
    : [];

  const criticalAlerts = result
    ? [
        {
          label: "Marca / proveedor",
          value: getCg(cg, ["restriccion_marca_proveedor"], "Sin restricción detectada"),
          detail: cleanValue(cg.evidencia_restricciones, "Sin evidencia adicional."),
          tone: cleanValue(cg.restriccion_marca_proveedor, "") ? "warn" : "ok"
        },
        {
          label: "Equivalentes",
          value: boolLabel(cg.permite_equivalentes),
          detail: "Indica si el pliego permite alternativas técnicas o productos iguales o superiores.",
          tone: asOptionalBool(cg.permite_equivalentes) === false ? "warn" : "neutral"
        },
        {
          label: "Propuesta técnica",
          value: proposalLines ? `${proposalGlobal} (${proposalLines})` : proposalGlobal,
          detail: cleanValue(cg.evidencia_propuesta_tecnica, "Sin evidencia textual capturada."),
          tone: proposalGlobal.toLowerCase().startsWith("si") ? "warn" : "neutral"
        },
        {
          label: "Ficha / catálogo",
          value: fichaCount ? `${fichaCount} renglón(es)` : "No pedida aparte",
          detail: "Solo cuenta entregables documentales, no simples especificaciones.",
          tone: fichaCount ? "warn" : "neutral"
        },
        {
          label: "Presencia local",
          value: presenceDecision.label,
          detail: presenceDecision.note,
          tone: presenceDecision.tone
        },
        {
          label: "Partes obsoletas / cartas",
          value: obsolCount ? `${obsolCount} renglón(es) a revisar` : "Sin alerta",
          detail: asBool(cg.permite_carta_obsolescencia) ? "El pliego permite carta de fabricante." : "No se detectó permiso específico para una carta.",
          tone: obsolCount || asBool(cg.permite_carta_obsolescencia) ? "warn" : "neutral"
        }
      ]
    : [];

  const visibleAlerts = criticalAlerts.filter((alert) => {
    if (viewMode === "advanced") return true;
    return alert.tone === "warn";
  });

  function rowStatus(item: RfqItem) {
    if (asOptionalBool(item.acepta_equivalente) === false) return { label: "Critico", tone: "warn" as const };
    if (asBool(item.requiere_ficha_tecnica) || asBool(item.posible_obsolescencia) || cleanValue(item.marca_modelo_requerido, "")) {
      return { label: "Revisar", tone: "warn" as const };
    }
    if (asBool(item.requiere_propuesta_tecnica)) return { label: "Preparar propuesta", tone: "warn" as const };
    return { label: "Normal", tone: "neutral" as const };
  }

  const detailFlags: DetailFlag[] = selectedItem
    ? [
        {
          label: "Código ACP",
          value: isValidAcpCode(selectedItem.codigo_articulo) ? cleanValue(selectedItem.codigo_articulo) : "S/C",
          tone: isValidAcpCode(selectedItem.codigo_articulo) ? "ok" : "neutral"
        },
        {
          label: "Cantidad",
          value: cleanValue(selectedItem.cantidad, "No especificada"),
          tone: "neutral"
        },
        {
          label: "Propuesta técnica",
          value: asBool(selectedItem.requiere_propuesta_tecnica) ? "Requerida" : "No requerida",
          tone: asBool(selectedItem.requiere_propuesta_tecnica) ? "warn" : "neutral"
        },
        {
          label: "Ficha / catálogo",
          value: asBool(selectedItem.requiere_ficha_tecnica) ? "Requerida" : "No pedida aparte",
          tone: asBool(selectedItem.requiere_ficha_tecnica) ? "warn" : "neutral"
        },
        {
          label: "Equivalentes",
          value: boolLabel(selectedItem.acepta_equivalente),
          tone: asOptionalBool(selectedItem.acepta_equivalente) === false ? "warn" : "neutral"
        },
        {
          label: "Partes obsoletas / cartas",
          value: asBool(selectedItem.posible_obsolescencia) ? "Revisar actualización" : "Sin alerta",
          tone: asBool(selectedItem.posible_obsolescencia) ? "warn" : "neutral"
        }
      ]
    : [];

  const tabs = [
    {
      id: "entrada" as const,
      label: "Entrada",
      detail: files.length ? `${files.length} archivo(s)` : "Subir PDFs"
    },
    {
      id: "resumen" as const,
      label: "Resumen",
      detail: result ? rfqNumber || "Análisis listo" : "Pendiente"
    },
    {
      id: "renglones" as const,
      label: "Renglones",
      detail: items.length ? `${items.length} item(s)` : "Sin matriz"
    }
  ];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Licitaciones"
          title="Análisis de RFQ"
          copy={result ? `RFQ ${rfqNumber || "sin número"} · ${items.length} renglón(es) detectados` : "Sube el pliego, anexos y enmiendas disponibles para iniciar el análisis."}
          actions={
            <>
              <StatusBadge tone={loadingConfig ? "warn" : hasStoredKey ? "ok" : "warn"}>
                {loadingConfig
                  ? "Validando Gemini"
                  : hasStoredKey
                    ? geminiSource === "admin_global"
                      ? "Gemini Admin"
                      : "Gemini lista"
                    : "Gemini pendiente"}
              </StatusBadge>
              {activeTab === "resumen" && result ? (
                <Button onClick={() => setActiveTab("renglones")} variant="primary" size="lg">
                  Revisar renglones
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : null}
            </>
          }
        />
      </ModuleSection>

      <section className="app-surface p-2">
        <div className="grid grid-cols-3 gap-2">
          {tabs.map((tab, index) => {
            const active = activeTab === tab.id;
            const disabled = tab.id !== "entrada" && !result;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => !disabled && setActiveTab(tab.id)}
                disabled={disabled}
                aria-current={active ? "step" : undefined}
                className={`app-tab-button px-2 py-3 sm:px-4 ${
                  active
                    ? "app-tab-button-active"
                    : disabled
                      ? "text-slate-400"
                      : ""
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold sm:gap-2 sm:text-sm">
                  <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] ${active ? "border-brand bg-brand text-white" : "border-line bg-white text-muted"}`}>{index + 1}</div>
                  {tab.label}
                </div>
                <span className="app-tab-detail ml-8 mt-1 text-xs leading-5 text-muted">{tab.detail}</span>
              </button>
            );
          })}
        </div>
      </section>

      {result && activeTab === "resumen" ? (
        <ModuleSection className="border-l-4 border-l-blue-500">
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr] xl:items-center">
            <div>
              <div className="text-sm font-semibold text-brand">Participación recomendada</div>
              <div className="mt-2 text-2xl font-semibold text-ink">{presenceDecision.company}</div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{presenceDecision.note}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {decisionStats.map(([label, value]) => (
                <div key={label} className="app-data-card">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                  <div className="mt-1 text-sm font-semibold text-ink">{value}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex justify-end border-t border-line pt-4">
            <div className="inline-flex rounded-lg border border-line bg-slate-50 p-1" aria-label="Nivel de detalle">
              {[
                ["simple", "Simple"],
                ["advanced", "Con evidencia"]
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode as "simple" | "advanced")}
                  className={`app-filter-pill px-3 py-1.5 text-sm font-semibold ${
                    viewMode === mode ? "app-filter-pill-active" : "app-filter-pill-idle"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </ModuleSection>
      ) : null}

      {activeTab === "entrada" || activeTab === "resumen" ? (
      <section className="grid gap-4">
        {activeTab === "entrada" ? (
        <div className="app-card mx-auto w-full max-w-4xl p-5" aria-busy={processing}>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand">Paso 1</div>
          <div className="mt-1 text-base font-semibold">Carga los documentos del RFQ</div>
          <p className="mt-2 text-sm leading-6 text-muted">Adjunta el pliego, anexos técnicos y enmiendas disponibles en formato PDF.</p>

          <label className="app-file-drop mt-5 min-h-40">
            <UploadCloud className="h-9 w-9 text-brand" />
            <span className="mt-3 text-sm font-semibold text-ink">Arrastra o selecciona los documentos</span>
            <span className="mt-1 text-xs text-muted">Puedes subir varios documentos</span>
            <input className="hidden" type="file" accept="application/pdf,.pdf" multiple onChange={handleFiles} />
          </label>

          {files.length ? (
            <div className="mt-4 space-y-2">
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 text-brand" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-muted">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                </div>
              ))}
            </div>
          ) : null}

          {!hasStoredKey ? (
            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Gemini API Key temporal</span>
              <input
                value={geminiKey}
                onChange={(event) => {
                  setGeminiKey(event.target.value);
                  setHasStoredKey(false);
                  setGeminiSource("temporal");
                }}
                className="app-input"
                placeholder="Solo si Admin aun no configuro Gemini"
                type="password"
              />
            </label>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted">
              {files.length ? `${files.length} documento(s) listo(s) para analizar.` : "Selecciona al menos un documento PDF para continuar."}
            </div>
            <Button onClick={handleAnalyze} disabled={processing || loadingConfig || !files.length} variant="primary" size="lg" className="w-full sm:w-auto">
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {processing
                ? progressStep === 1 ? "Enviando documentos..."
                  : progressStep === 2 ? "Analizando con IA..."
                  : progressStep === 3 ? "Extrayendo renglones..."
                  : progressStep === 4 ? "Guardando análisis..."
                  : "Procesando..."
                : "Procesar RFQ"}
            </Button>
          </div>

          {processing ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
              {[
                { step: 1, label: "Documentos" },
                { step: 2, label: "IA Gemini" },
                { step: 3, label: "Renglones" },
                { step: 4, label: "Guardando" }
              ].map(({ step, label }) => (
                <span key={step} className="app-progress-step">
                  <span className={`app-progress-step-dot ${step < progressStep ? "app-progress-step-dot-done" : step === progressStep ? "app-progress-step-dot-active" : "app-progress-step-dot-pending"}`} />
                  <span className={step <= progressStep ? "font-semibold" : "opacity-50"}>{label}</span>
                </span>
              ))}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}

          {saveNotice ? (
            <div className={`mt-4 rounded-lg border p-3 text-sm ${saveNotice.includes("no se pudo") ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
              {saveNotice}
            </div>
          ) : null}
        </div>
        ) : null}

        {activeTab === "resumen" ? (
        <div className="app-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand">Información principal</div>
              <div className="mt-1 text-base font-semibold">Datos de la licitación</div>
              <p className="mt-1 text-sm text-muted">Datos críticos extraídos para decidir y cotizar.</p>
            </div>
            {result ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Analizado</span> : null}
          </div>

          {result ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {(viewMode === "advanced" ? generalCards : simpleGeneralCards).map(([label, value]) => (
                  <div key={label} className="app-data-card">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                    <div className="mt-2 text-sm font-semibold leading-5 text-slate-900">{value}</div>
                  </div>
                ))}
              </div>

              {viewMode === "advanced" ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className={`rounded-lg border p-3 ${decisionTone(presenceDecision.tone)}`}>
                  <div className="text-xs font-semibold uppercase tracking-wide">Decision de participacion</div>
                  <div className="mt-2 text-sm font-semibold">{presenceDecision.company}</div>
                  <p className="mt-1 text-xs leading-5">{presenceDecision.note}</p>
                </div>
                <div className="app-data-card">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">Restricción / equivalentes</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">
                    {getCg(cg, ["restriccion_marca_proveedor"], "Sin restricción detectada")}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Equivalentes: {boolLabel(cg.permite_equivalentes)} | Carta obsolescencia: {asBool(cg.permite_carta_obsolescencia) ? "Si" : "No"}
                  </p>
                </div>
              </div>
              ) : null}

              {viewMode === "advanced" ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {metrics.map(([label, value]) => (
                  <div key={label} className="app-data-card bg-white">
                    <div className="text-xs text-muted">{label}</div>
                    <div className="mt-1 text-2xl font-semibold">{value}</div>
                  </div>
                ))}
              </div>
              ) : null}

              {viewMode === "advanced" ? (
              <div className="mt-5 rounded-xl border border-line bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <ShieldAlert className="h-4 w-4 text-brand" />
                  Estado del análisis
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {analysisState.map((flag) => (
                    <div key={flag.label} className={`rounded-lg border p-3 ${flagTone(flag.tone)}`}>
                      <div className="text-xs font-semibold uppercase tracking-wide">{flag.label}</div>
                      <div className="mt-1 text-sm font-semibold">{flag.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              ) : null}

              {viewMode === "advanced" && (cleanValue(cg.evidencia_propuesta_tecnica, "") || cleanValue(cg.evidencia_restricciones, "")) ? (
                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  {cleanValue(cg.evidencia_propuesta_tecnica, "") ? (
                    <div className="rounded-lg border border-line bg-slate-50 p-4">
                      <div className="text-sm font-semibold">Evidencia de propuesta técnica</div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{cleanValue(cg.evidencia_propuesta_tecnica)}</p>
                    </div>
                  ) : null}
                  {cleanValue(cg.evidencia_restricciones, "") ? (
                    <div className="rounded-lg border border-line bg-slate-50 p-4">
                      <div className="text-sm font-semibold">Evidencia técnica general</div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{cleanValue(cg.evidencia_restricciones)}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        ) : null}
      </section>
      ) : null}


      {result && activeTab === "resumen" ? (
        <section className="app-surface">
          <div className="border-b border-line p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand">Pendientes</div>
            <div className="mt-1 text-base font-semibold">Antes de solicitar cotización</div>
            <p className="mt-1 text-sm text-muted">Requisitos que necesitan preparación o confirmación.</p>
          </div>
          <div className="divide-y divide-line">
            {visibleAlerts.length ? (
              visibleAlerts.map((alert) => (
                <details key={alert.label} className="group p-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${alert.tone === "warn" ? "bg-amber-500" : alert.tone === "ok" ? "bg-emerald-500" : "bg-slate-400"}`} />
                        <span className="text-sm font-semibold">{alert.label}</span>
                      </div>
                      <div className="mt-1 truncate text-sm text-muted">{alert.value}</div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-brand">Ver evidencia</span>
                  </summary>
                  <p className="mt-3 rounded-lg border border-line bg-slate-50 p-3 text-sm leading-6 text-slate-700">{alert.detail}</p>
                </details>
              ))
            ) : (
              <div className="p-4 text-sm text-muted">No se detectaron revisiones urgentes. La evidencia completa permanece disponible en la vista avanzada.</div>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "renglones" && items.length ? (
        <section className="app-surface">
          <div className="border-b border-line p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand">Matriz técnica</div>
            <div className="mt-1 text-base font-semibold">Renglones y requisitos</div>
            <p className="mt-1 text-sm text-muted">Selecciona un renglón para revisar sus requisitos y continuar con proveedores, costos, logística o correo.</p>
          </div>

          <div className="app-scrollbar overflow-x-auto">
              <table className="app-table">
                <thead>
                <tr>
                  {(viewMode === "advanced"
                    ? ["Renglón", "Código ACP", "Descripción", "Cantidad", "Unidad", "Prop. técnica", "Ficha", "Marca / restricción", "Equiv.", "Obsol."]
                    : ["Renglón", "Código ACP", "Descripción", "Cantidad", "Estado"]
                  ).map((heading) => (
                    <th key={heading} className="border-b border-line px-4 py-3 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr
                    key={`${cleanValue(item.renglon, String(index))}-${index}`}
                    onClick={() => setSelectedIndex(index)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setSelectedIndex(index);
                    }}
                    tabIndex={0}
                    className={`cursor-pointer border-b border-line last:border-0 hover:bg-slate-50 ${selectedIndex === index ? "bg-blue-50/60" : ""}`}
                  >
                    <td className="px-4 py-3 font-semibold">{cleanValue(item.renglon, String(index + 1))}</td>
                    <td className="px-4 py-3">
                      <div className={isValidAcpCode(item.codigo_articulo) ? "font-semibold text-brand" : "font-semibold text-muted"}>
                        {isValidAcpCode(item.codigo_articulo) ? cleanValue(item.codigo_articulo) : "S/C"}
                      </div>
                      {!isValidAcpCode(item.codigo_articulo) ? <div className="mt-1 text-xs text-muted">No indicado</div> : null}
                    </td>
                    <td className="max-w-[360px] px-4 py-3">
                      <div className="truncate font-medium">{cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa)}</div>
                    </td>
                    <td className="px-4 py-3">{cleanValue(item.cantidad, "-")}</td>
                    {viewMode === "advanced" ? (
                      <>
                        <td className="px-4 py-3">{cleanValue(item.unidad_de_medida || item.unidad, "-")}</td>
                        <td className="px-4 py-3">{asBool(item.requiere_propuesta_tecnica) ? "Si" : "No"}</td>
                        <td className="px-4 py-3">{asBool(item.requiere_ficha_tecnica) ? "Si" : "No"}</td>
                        <td className="max-w-[260px] px-4 py-3">{cleanValue(item.marca_modelo_requerido, "No especificado")}</td>
                        <td className="px-4 py-3">{boolLabel(item.acepta_equivalente)}</td>
                        <td className="px-4 py-3">{asBool(item.posible_obsolescencia) ? "Revisar" : "No"}</td>
                      </>
                    ) : (
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${flagTone(rowStatus(item).tone)}`}>
                          {rowStatus(item).label}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedItem ? (
            <div className="border-t border-line p-4">
              <div className="mb-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-brand">Renglón seleccionado</div>
                <div className="mt-1 text-sm font-semibold">{itemLabel(selectedItem, selectedIndex)}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {detailFlags.map((flag) => (
                  <div key={flag.label} className={`rounded-lg border p-3 ${flagTone(flag.tone)}`}>
                    <div className="text-xs font-semibold uppercase tracking-wide">{flag.label}</div>
                    <div className="mt-1 text-sm font-semibold">{flag.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <details className="rounded-lg border border-line bg-slate-50 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">Ver especificación técnica</summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {cleanValue(selectedItem.ficha_tecnica_completa || selectedItem.descripcion)}
                  </p>
                </details>
                <details className="rounded-lg border border-line bg-slate-50 p-4">
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Ver evidencia del documento
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {cleanValue(selectedItem.evidencia_tecnica, "No especificado en los documentos adjuntos")}
                  </p>
                </details>
              </div>
              <div className="mt-4 border-t border-line pt-4">
                <div className="mb-3 text-xs font-semibold uppercase text-muted">Siguiente paso</div>
                <div className="flex flex-wrap gap-2">
                <Button onClick={() => openModuleFromItem("proveedores")} variant="primary"><PackageSearch className="h-4 w-4" />Buscar proveedores</Button>
                <Button onClick={() => openModuleFromItem("costos")} variant="secondary"><BarChart3 className="h-4 w-4" />Comparar costos</Button>
                <Button onClick={() => openModuleFromItem("logistica")} variant="secondary"><Truck className="h-4 w-4" />Calcular logística</Button>
                <Button onClick={() => openModuleFromItem("rfq_email")} variant="secondary"><Mail className="h-4 w-4" />Generar correo RFQ</Button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "renglones" && !items.length ? (
        <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-muted">
          Procesa primero un RFQ para ver la matriz de renglones.
        </section>
      ) : null}
    </div>
  );
}










