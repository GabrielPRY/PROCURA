"use client";

import { AlertTriangle, CheckCircle2, ClipboardList, Download, FileText, Loader2, Search, UploadCloud, XCircle } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { evaluateSupplierProposal, loadSupplierEvaluationDraft, type EvaluationResultValue, type SupplierEvaluationRow } from "@/lib/evaluation";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { asBool, cleanValue, getUserConfig, loadActiveRfqContext, loadLastRfq, type ActiveRfqItemContext, type RfqAnalysisResponse, type RfqItem } from "@/lib/rfq";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type Scope = "Todos los renglones" | "Renglones seleccionados en Proveedores" | "Renglón seleccionado desde RFQ" | "Solo renglones con propuesta técnica" | "Solo renglones con ficha/catálogo";
type ResultFilter = "Todos" | EvaluationResultValue;
type EvaluationTab = "preparar" | "resultado";

const resultOptions: EvaluationResultValue[] = ["Cumple", "No cumple", "Cumple parcialmente", "No encontrado"];
const actionOptions = ["Aceptar", "Pedir aclaración", "Rechazar", "Revisar manualmente"];

function statusTone(status: string) {
  if (status === "Cumple") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "Cumple parcialmente") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "No cumple") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function filterItems(items: RfqItem[], scope: Scope, activeIndex = 0, providerIndexes: number[] = []) {
  if (scope === "Renglones seleccionados en Proveedores") {
    return providerIndexes.filter((index) => items[index]).map((index) => items[index]);
  }
  if (scope === "Renglón seleccionado desde RFQ") {
    return items[activeIndex] ? [items[activeIndex]] : [];
  }
  if (scope === "Solo renglones con propuesta técnica") {
    return items.filter((item) => asBool(item.requiere_propuesta_tecnica));
  }
  if (scope === "Solo renglones con ficha/catálogo") {
    return items.filter((item) => asBool(item.requiere_ficha_tecnica));
  }
  return items;
}

function confidenceTone(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("alta")) return "text-emerald-700";
  if (normalized.includes("baja")) return "text-rose-700";
  return "text-amber-700";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function shortText(value: unknown, fallback = "-", maxLength = 120) {
  const text = cleanValue(value, fallback);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

export function EvaluationConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [supplier, setSupplier] = useState("");
  const [evaluationNotes, setEvaluationNotes] = useState("");
  const [scope, setScope] = useState<Scope>("Todos los renglones");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("Todos");
  const [geminiKey, setGeminiKey] = useState("");
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [rows, setRows] = useState<SupplierEvaluationRow[]>([]);
  const [activeTab, setActiveTab] = useState<EvaluationTab>("preparar");
  const [activeRfqContext, setActiveRfqContext] = useState<ActiveRfqItemContext | null>(null);
  const [providerItemIndexes, setProviderItemIndexes] = useState<number[]>([]);

  useEffect(() => {
    const savedRfq = loadLastRfq(user.username);
    const context = loadActiveRfqContext(user.username);
    const providerDraft = loadSupplierEvaluationDraft(user.username);
    setRfq(savedRfq);
    setActiveRfqContext(context?.target_module === "evaluacion" ? context : null);
    if (savedRfq?.items?.length && providerDraft?.item_indexes?.length) {
      const validIndexes = providerDraft.item_indexes.filter((index) => savedRfq.items?.[index]);
      setProviderItemIndexes(validIndexes);
      setSupplier(providerDraft.supplier_name || "");
      setScope("Renglones seleccionados en Proveedores");
      if (providerDraft.provider_url) {
        setEvaluationNotes((current) => current || `Proveedor seleccionado desde sourcing: ${providerDraft.provider_url}`);
      }
    } else if (savedRfq?.items?.length && context?.target_module === "evaluacion") {
      setScope("Renglón seleccionado desde RFQ");
      setEvaluationNotes((current) =>
        current ||
        [
          `Evaluar contra el renglón ${context.renglon || context.item_index + 1}.`,
          context.codigo_acp ? `Codigo ACP: ${context.codigo_acp}` : "",
          context.requiere_propuesta_tecnica ? "El RFQ marca propuesta técnica requerida para este renglón." : "",
          context.requiere_ficha_tecnica ? "El RFQ marca ficha/catálogo requerido para este renglón." : "",
          context.evidencia_tecnica ? `Evidencia RFQ: ${context.evidencia_tecnica}` : ""
        ].filter(Boolean).join("\n")
      );
    }
    let mounted = true;
    getUserConfig(user.username)
      .then((config) => {
        if (!mounted) return;
        setGeminiKey(config.gemini_key || "");
        setHasGeminiKey(Boolean(config.has_gemini_key || config.gemini_key));
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoadingConfig(false);
      });
    return () => {
      mounted = false;
    };
  }, [user.username]);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files || []));
    setActiveTab("preparar");
  }

  const cg = rfq?.condiciones_generales || {};
  const allItems = useMemo(() => rfq?.items || [], [rfq]);
  const activeItemIndex = activeRfqContext?.target_module === "evaluacion" ? Number(activeRfqContext.item_index) || 0 : 0;
  const scopedItems = useMemo(() => filterItems(allItems, scope, activeItemIndex, providerItemIndexes), [activeItemIndex, allItems, providerItemIndexes, scope]);
  const licitacion = cleanValue(cg.numero_licitacion, "Sin RFQ cargado");
  const counts = {
    cumple: rows.filter((row) => row.resultado === "Cumple").length,
    parcial: rows.filter((row) => row.resultado === "Cumple parcialmente").length,
    noCumple: rows.filter((row) => row.resultado === "No cumple").length,
    noEncontrado: rows.filter((row) => row.resultado === "No encontrado").length,
    total: rows.length
  };
  const visibleRows = useMemo(() => {
    const indexed = rows.map((row, index) => ({ row, index }));
    if (resultFilter === "Todos") return indexed;
    return indexed.filter(({ row }) => row.resultado === resultFilter);
  }, [resultFilter, rows]);
  const decisionLabel = counts.noCumple > 0
    ? "Existe incumplimiento técnico"
    : counts.noEncontrado > 0
      ? "Falta evidencia para decidir"
    : counts.parcial > 0
      ? "Puede avanzar con aclaraciones"
      : counts.total > 0
        ? "Cumplimiento favorable"
        : "Pendiente de evaluar";

  async function runEvaluation() {
    setError(null);
    if (!rfq || !scopedItems.length) {
      setError("Primero analiza un RFQ con renglones técnicos.");
      return;
    }
    if (!files.length) {
      setError("Sube al menos un archivo de propuesta del proveedor.");
      return;
    }
    if (!geminiKey.trim() && !hasGeminiKey) {
      setError("Falta Gemini API Key. Configurala en Admin o en el perfil del usuario.");
      return;
    }

    setProcessing(true);
    try {
      const response = await evaluateSupplierProposal({
        files,
        items: scopedItems,
        cg,
        geminiKey: geminiKey.trim(),
        username: user.username,
        role: normalizeRole(user.role),
        supplierName: supplier.trim(),
        evaluationNotes: evaluationNotes.trim()
      });
      setRows(response.evaluaciones || []);
      setSummary(response.resumen || "");
      setActiveTab("resultado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo evaluar la propuesta.");
    } finally {
      setProcessing(false);
    }
  }

  function updateRow(index: number, patch: Partial<SupplierEvaluationRow>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function downloadCsv() {
    if (!rows.length) return;
    const headers = [
      "Proveedor",
      "RFQ",
      "Renglón",
      "Codigo ACP",
      "Descripcion",
      "Resultado",
      "Confianza",
      "Requisito ACP",
      "Oferta proveedor",
      "Faltante o riesgo",
      "Acción sugerida",
      "Evidencia"
    ];
    const lines = [
      headers.map(csvEscape).join(","),
      ...rows.map((row) => [
        supplier || "No indicado",
        licitacion,
        row.renglon,
        row.codigo_articulo,
        row.descripcion,
        row.resultado,
        row.confianza,
        row.requisito_acp,
        row.oferta_proveedor,
        row.faltante_o_riesgo,
        row.accion_sugerida,
        row.evidencia
      ].map(csvEscape).join(","))
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `evaluacion-${licitacion}-${supplier || "proveedor"}.csv`.replace(/[^\w.-]+/g, "_");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const tabs = [
    {
      id: "preparar" as const,
      label: "Preparar",
      detail: files.length ? `${files.length} archivo(s)` : "Subir propuesta"
    },
    {
      id: "resultado" as const,
      label: "Resultado",
      detail: rows.length ? `${counts.noCumple + counts.noEncontrado + counts.parcial} por revisar` : "Sin evaluar"
    }
  ];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Módulo Evaluación"
          title="Propuesta del proveedor vs RFQ"
          copy="Compara la oferta del proveedor contra lo que exige ACP. Si algo no está evidenciado, queda marcado para pedir aclaración antes de ofertar."
          actions={
            <>
              <StatusBadge tone={hasGeminiKey ? "ok" : "warn"}>{loadingConfig ? "Validando IA" : hasGeminiKey ? "Gemini lista" : "Gemini pendiente"}</StatusBadge>
              <StatusBadge tone="info">RFQ: {licitacion}</StatusBadge>
            </>
          }
        />
      </ModuleSection>

      <ModuleSection className="p-2">
        <div className="grid gap-2 md:grid-cols-2">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            const disabled = tab.id !== "preparar" && !rows.length;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => !disabled && setActiveTab(tab.id)}
                disabled={disabled}
                className={`app-tab-button ${active ? "app-tab-button-active" : ""}`}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{tab.detail}</span>
              </button>
            );
          })}
        </div>
      </ModuleSection>

      {!rfq ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-800">
          Primero analiza un RFQ en el módulo RFQ. Cuando termines, vuelve aquí y la matriz técnica se cargará automáticamente.
        </section>
      ) : (
        <>
          {activeTab === "preparar" ? (
          <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(320px,0.42fr)_minmax(0,0.58fr)]">
            <ModuleSection className="min-w-0">
              <div className="text-base font-semibold">Propuesta del proveedor</div>
              <p className="mt-2 text-sm leading-6 text-muted">Sube la cotización, ficha, catálogo o documento técnico que envió el proveedor.</p>

              <label className="mt-5 grid min-h-44 cursor-pointer place-items-center rounded-xl border border-dashed border-blue-200 bg-blue-50/50 p-6 text-center transition hover:border-brand hover:bg-blue-50">
                <UploadCloud className="h-8 w-8 text-brand" />
                <span className="mt-3 text-sm font-semibold text-slate-800">Seleccionar propuesta</span>
                <span className="mt-1 text-xs text-muted">PDF, XLSX, DOCX, TXT o CSV</span>
                <input className="hidden" type="file" accept=".pdf,.xlsx,.xls,.docx,.txt,.csv" multiple onChange={handleFiles} />
              </label>

              {files.length ? (
                <div className="mt-4 space-y-2">
                  {files.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
                      <FileText className="h-4 w-4 text-brand" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Nombre del proveedor evaluado</span>
                <input
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  className="app-input"
                  placeholder="Ej: Rexroth distributor, proveedor local, fabricante..."
                />
              </label>

              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Cambios o condiciones especiales del RFQ</span>
                <textarea
                  value={evaluationNotes}
                  onChange={(event) => setEvaluationNotes(event.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-line bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                  placeholder="Ej: Enmienda 1 cambia cantidad; solo aplica para líneas 3 y 4; requiere carta de fabricante; el proveedor ofrece alternativa técnica..."
                />
              </label>

              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Renglones a comparar</span>
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as Scope)}
                  className="app-input"
                >
                  <option>Todos los renglones</option>
                  {providerItemIndexes.length ? <option>Renglones seleccionados en Proveedores</option> : null}
                  {activeRfqContext ? <option>Renglón seleccionado desde RFQ</option> : null}
                  <option>Solo renglones con propuesta técnica</option>
                  <option>Solo renglones con ficha/catálogo</option>
                </select>
              </label>

              <Button onClick={runEvaluation} disabled={processing || loadingConfig} variant="primary" size="lg" className="mt-5 w-full">
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                {processing ? "Evaluando..." : "Evaluar propuesta"}
              </Button>

              {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
            </ModuleSection>

            <ModuleSection className="min-w-0">
              <div className="text-base font-semibold">Alcance de la evaluación</div>
              <p className="mt-2 text-sm text-muted">El sistema cruza la propuesta contra los requisitos técnicos extraídos del último RFQ.</p>
              {activeRfqContext ? (
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                  <div className="font-semibold">Renglón recibido desde RFQ</div>
                  Renglón {activeRfqContext.renglon || activeRfqContext.item_index + 1} | {activeRfqContext.codigo_acp || "S/C"} |{" "}
                  {activeRfqContext.descripcion || "Sin descripcion"}
                </div>
              ) : null}
              <div className="mt-5 overflow-hidden rounded-lg border border-line bg-slate-50 sm:grid sm:grid-cols-3 sm:divide-x sm:divide-line">
                {[
                  ["RFQ", licitacion],
                  ["Renglones", String(scopedItems.length)],
                  ["Proveedor", supplier || "No indicado"]
                ].map(([label, value]) => (
                  <div key={label} className="border-t border-line px-4 py-3 first:border-t-0 sm:border-t-0">
                    <div className="text-xs font-semibold text-muted">{label}</div>
                    <div className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-l-2 border-blue-500 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                <span className="font-semibold">Criterio de lectura:</span> la falta de evidencia queda como No encontrado, no como incumplimiento. Los anexos y enmiendas tienen prioridad sobre el RFQ original.
              </div>
            </ModuleSection>
          </section>
          ) : null}

          {activeTab === "resultado" && rows.length ? (
            <section className="rounded-xl border border-line bg-panel shadow-sm">
              <div className="border-b border-line p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-base font-semibold">Resultado de la evaluación</div>
                    <p className="mt-1 text-sm text-muted">Vista resumida para decidir rápido. Abre el detalle solo cuando necesites auditar evidencia.</p>
                  </div>
                  <Button type="button" onClick={downloadCsv} variant="secondary" size="md">
                    <Download className="h-4 w-4" />
                    Descargar CSV
                  </Button>
                </div>
                <div className={`mt-4 rounded-xl border p-4 ${
                  counts.noCumple > 0
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : counts.noEncontrado > 0 || counts.parcial > 0
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide opacity-75">Conclusión</div>
                      <div className="mt-1 text-xl font-semibold">{decisionLabel}</div>
                      <p className="mt-2 max-w-3xl text-sm leading-6">
                        {counts.noCumple > 0
                          ? "La oferta contradice al menos un requisito. Revisa el detalle antes de continuar."
                          : counts.noEncontrado > 0
                            ? "La propuesta no demuestra todos los requisitos. Solicita la evidencia faltante antes de decidir."
                          : counts.parcial > 0
                            ? "Puede continuar, pero conviene cerrar las aclaraciones antes de ofertar."
                            : "La propuesta luce favorable contra los requisitos evaluados."}
                      </p>
                    </div>
                    <div className="grid min-w-0 grid-cols-2 gap-2 text-center sm:grid-cols-4">
                      <div className="rounded-lg bg-white/70 p-3">
                        <div className="text-xs font-semibold opacity-70">Cumple</div>
                        <div className="mt-1 text-2xl font-semibold">{counts.cumple}</div>
                      </div>
                      <div className="rounded-lg bg-white/70 p-3">
                        <div className="text-xs font-semibold opacity-70">Parcial</div>
                        <div className="mt-1 text-2xl font-semibold">{counts.parcial}</div>
                      </div>
                      <div className="rounded-lg bg-white/70 p-3">
                        <div className="text-xs font-semibold opacity-70">No demostrado</div>
                        <div className="mt-1 text-2xl font-semibold">{counts.noEncontrado}</div>
                      </div>
                      <div className="rounded-lg bg-white/70 p-3">
                        <div className="text-xs font-semibold opacity-70">No cumple</div>
                        <div className="mt-1 text-2xl font-semibold">{counts.noCumple}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_260px]">
                  {summary ? <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm leading-6 text-slate-700">{summary}</div> : <div />}
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
                      value={resultFilter}
                      onChange={(event) => setResultFilter(event.target.value as ResultFilter)}
                      className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none"
                    >
                      <option value="Todos">Todos los resultados</option>
                      {resultOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div className="grid gap-3 p-4">
                {visibleRows.map(({ row, index }) => {
                  const isOk = row.resultado === "Cumple";
                  const isBad = row.resultado === "No cumple";
                  const ResultIcon = isOk ? CheckCircle2 : isBad ? XCircle : AlertTriangle;
                  return (
                    <article key={`${row.renglon}-${index}`} className="rounded-xl border border-line bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-brand">
                              Renglón {cleanValue(row.renglon, "-")}
                            </span>
                            <span className="rounded-full border border-line bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              {cleanValue(row.codigo_articulo, "S/C")}
                            </span>
                          </div>
                          <h3 className="mt-3 text-base font-semibold leading-6 text-slate-950">{shortText(row.descripcion, "Sin descripcion", 140)}</h3>
                          <p className="mt-2 text-sm leading-6 text-slate-700">{shortText(row.faltante_o_riesgo, "Sin riesgo identificado.", 220)}</p>
                          <div className={`mt-2 text-xs font-semibold ${confidenceTone(row.confianza)}`}>Confianza: {cleanValue(row.confianza, "Media")}</div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:w-[420px]">
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Resultado</span>
                            <div className="relative">
                              <ResultIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
                              <select
                                value={row.resultado}
                                onChange={(event) => updateRow(index, { resultado: event.target.value as EvaluationResultValue })}
                                className={`w-full rounded-lg border py-2 pl-8 pr-2 text-sm font-semibold ${statusTone(row.resultado)}`}
                              >
                                {resultOptions.map((option) => <option key={option}>{option}</option>)}
                              </select>
                            </div>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Acción</span>
                            <select
                              value={row.accion_sugerida || "Revisar manualmente"}
                              onChange={(event) => updateRow(index, { accion_sugerida: event.target.value })}
                              className="h-10 w-full rounded-lg border border-line bg-white px-2 text-sm font-semibold text-slate-800"
                            >
                              {actionOptions.map((option) => <option key={option}>{option}</option>)}
                            </select>
                          </label>
                        </div>
                      </div>
                      <details className="mt-4 rounded-lg border border-line bg-slate-50 p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-brand">Ver requisito ACP, oferta y evidencia</summary>
                        <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-700 lg:grid-cols-3">
                          <div><b>Requisito ACP:</b><br />{cleanValue(row.requisito_acp)}</div>
                          <div><b>Oferta proveedor:</b><br />{cleanValue(row.oferta_proveedor)}</div>
                          <div><b>Evidencia:</b><br />{cleanValue(row.evidencia)}{row.documento_fuente || row.pagina_fuente ? <><br /><span className="text-xs text-muted">Fuente: {cleanValue(row.documento_fuente, "Documento no identificado")}{row.pagina_fuente ? ` · Página ${row.pagina_fuente}` : ""}</span></> : null}</div>
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeTab === "resultado" && !rows.length ? (
            <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-muted">
              Todavía no hay resultado. Sube la propuesta del proveedor en Preparar y ejecuta la evaluación.
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}



