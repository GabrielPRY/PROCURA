"use client";

import { AlertTriangle, BarChart3, CheckCircle2, Database, Loader2, Search, Target, TrendingDown, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type AuthUser } from "@/lib/auth";
import { getHistorico, type HistoricoRow } from "@/lib/historico";
import { cleanValue, loadLastRfq, type RfqAnalysisResponse, type RfqItem } from "@/lib/rfq";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";

type CostRow = RfqItem & Record<string, unknown>;
type ItemHistoryMatch = { search: string; rows: HistoricoRow[]; error?: string };

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .replace(/[$,\s]/g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function normalizeColumnName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function cell(row: Record<string, unknown>, keys: string[], fallback = "N/D") {
  for (const key of keys) {
    const value = cleanValue(row[key], "");
    if (value) return value;
  }
  const normalized = new Map(Object.keys(row).map((key) => [normalizeColumnName(key), key]));
  for (const key of keys) {
    const actual = normalized.get(normalizeColumnName(key));
    if (!actual) continue;
    const value = cleanValue(row[actual], "");
    if (value) return value;
  }
  return fallback;
}

function priceFrom(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toNumber(row[key]);
    if (value > 0) return value;
  }
  return 0;
}

function average(values: number[]) {
  const valid = values.filter((value) => value > 0);
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function minPositive(values: number[]) {
  const valid = values.filter((value) => value > 0);
  return valid.length ? Math.min(...valid) : 0;
}
function historyPricesFromRows(rows: HistoricoRow[]) {
  return rows.flatMap((row) => {
    const record = row as Record<string, unknown>;
    return [
      priceFrom(record, ["Precio Proyelec", "PRECIO PROYELEC", "precio_proyelec"]),
      priceFrom(record, ["Precio Competencia", "PRECIO COMPETENCIA", "precio_competencia"])
    ].filter((value) => value > 0);
  });
}

function bestHistoryPrice(rows: HistoricoRow[]) {
  return minPositive(historyPricesFromRows(rows));
}
function specialistInitials(value: string) {
  const clean = cleanValue(value, "");
  if (!clean || clean === "N/D") return "-";
  const tokens = clean.split(/\s+/).filter(Boolean);
  return tokens.slice(0, 2).map((token) => token.charAt(0).toUpperCase()).join("") || "-";
}

function historicalDateLabel(record: Record<string, unknown>) {
  const mes = cell(record, ["Mes", "mes"], "");
  const anio = cell(record, ["Año", "Ano", "AÃ±o", "anio"], "");
  if (mes && anio) return `${mes} ${anio}`;
  return mes || anio || "N/D";
}

function itemLabel(item: CostRow, index: number) {
  const renglon = cleanValue(item.renglon, String(index + 1));
  const code = cleanValue(item.codigo_articulo, "S/C");
  const desc = cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "Sin descripcion");
  return `Renglon ${renglon} | ${code} | ${desc.slice(0, 68)}`;
}

function itemSearchTerm(item?: CostRow | null) {
  if (!item) return "";
  const code = cleanValue(item.codigo_articulo, "");
  if (code && code !== "No especificado") return code;
  return cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "");
}

export function CostAnalysisConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [manualSearch, setManualSearch] = useState("");
  const [historicoRows, setHistoricoRows] = useState<HistoricoRow[]>([]);
  const [itemHistoryMap, setItemHistoryMap] = useState<Record<number, ItemHistoryMatch>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingBatchHistory, setLoadingBatchHistory] = useState(false);
  const [batchHistoryReady, setBatchHistoryReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadLastRfq(user.username);
    setRfq(saved);
    setSelectedIndex(0);
  }, [user.username]);

  const items = useMemo(() => (rfq?.items || []) as CostRow[], [rfq]);
  const selectedItem = items[selectedIndex] || null;
  const activeSearch = manualSearch.trim() || itemSearchTerm(selectedItem);

  useEffect(() => {
    let cancelled = false;
    setBatchHistoryReady(false);
    setItemHistoryMap({});

    const targets = items
      .map((item, index) => ({ index, search: itemSearchTerm(item) }))
      .filter((target) => target.search);

    if (!targets.length) {
      setLoadingBatchHistory(false);
      setBatchHistoryReady(true);
      return () => {
        cancelled = true;
      };
    }

    setLoadingBatchHistory(true);
    Promise.all(
      targets.map(async (target) => {
        try {
          const response = await getHistorico({ search: target.search, anio: "Todos", limit: 80 });
          return [target.index, { search: target.search, rows: response.rows || [] }] as const;
        } catch (err) {
          return [target.index, { search: target.search, rows: [], error: err instanceof Error ? err.message : "Error consultando histórico" }] as const;
        }
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setItemHistoryMap(Object.fromEntries(entries));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBatchHistory(false);
          setBatchHistoryReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    if (!activeSearch) {
      setHistoricoRows([]);
      return;
    }
    let mounted = true;
    const timer = window.setTimeout(() => {
      setLoadingHistory(true);
      setError(null);
      getHistorico({ search: activeSearch, anio: "Todos", limit: 250 })
        .then((response) => {
          if (!mounted) return;
          setHistoricoRows(response.rows || []);
        })
        .catch((err) => {
          if (!mounted) return;
          setHistoricoRows([]);
          setError(err instanceof Error ? err.message : "No se pudo consultar el historico de costos.");
        })
        .finally(() => {
          if (mounted) setLoadingHistory(false);
        });
    }, 350);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [activeSearch]);

  const itemRows = items.map((item, index) => {
    const qty = toNumber(item.cantidad);
    const comp = priceFrom(item, ["precio_comp_hist", "PRECIO COMPETENCIA", "Precio Competencia", "precio_competencia"]);
    const proy = priceFrom(item, ["precio_proy_hist", "PRECIO PROYELEC", "Precio Proyelec", "precio_proyelec"]);
    const autoHistory = itemHistoryMap[index]?.rows || [];
    const historyBest = bestHistoryPrice(autoHistory);
    const best = minPositive([comp, proy, historyBest]);
    return {
      index,
      item,
      qty,
      comp,
      proy,
      historyBest,
      historyRows: autoHistory,
      best,
      valueBest: qty * best,
      hasEmbeddedHistory: comp > 0 || proy > 0,
      hasAutoHistory: autoHistory.length > 0,
      hasHistoricalPrice: best > 0
    };
  });

  const embeddedMatches = itemRows.filter((row) => row.hasHistoricalPrice).length;
  const totalReference = itemRows.reduce((sum, row) => sum + row.valueBest, 0);
  const rfqNumber = cleanValue(rfq?.condiciones_generales?.numero_licitacion || rfq?.condiciones_generales?.licitacion, "RFQ activo");

  const historyPrices = historyPricesFromRows(historicoRows);
  const minHistory = minPositive(historyPrices);
  const avgHistory = average(historyPrices);
  const aggressiveReference = minHistory > 0 ? minHistory * 0.97 : 0;
  const selectedQty = toNumber(selectedItem?.cantidad) || 1;
  const selectedEmbeddedComp = selectedItem ? priceFrom(selectedItem, ["precio_comp_hist", "PRECIO COMPETENCIA", "Precio Competencia", "precio_competencia"]) : 0;
  const selectedEmbeddedProy = selectedItem ? priceFrom(selectedItem, ["precio_proy_hist", "PRECIO PROYELEC", "Precio Proyelec", "precio_proyelec"]) : 0;
  const selectedAutoBest = selectedIndex >= 0 ? bestHistoryPrice(itemHistoryMap[selectedIndex]?.rows || []) : 0;
  const selectedBest = minPositive([selectedEmbeddedComp, selectedEmbeddedProy, minHistory, selectedAutoBest]);

  const summaryCards = [
    ["Renglones RFQ", String(items.length), "Cantidad de partidas detectadas."],
    ["Cruce directo", `${embeddedMatches}/${items.length}`, "Historial ya cruzado durante el RFQ."],
    ["Referencia total", money(totalReference), "Suma con mejor precio historico disponible por renglon."],
    ["Historico consultado", String(historicoRows.length), "Registros encontrados para el renglon activo."]
  ];
  const insightCards: Array<[string, string, LucideIcon]> = [
    ["Minimo historico", minHistory ? money(minHistory) : "N/D", TrendingDown],
    ["Promedio historico", avgHistory ? money(avgHistory) : "N/D", BarChart3],
    ["Referencia agresiva", aggressiveReference ? money(aggressiveReference) : "N/D", Target],
    ["Valor x cantidad", selectedBest ? money(selectedBest * selectedQty) : "N/D", Database]
  ];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Analisis de Costos"
          title="Competitividad historica por renglon"
          copy="Consulta el historico de Supabase y muestra referencias para decidir precio objetivo sin inventar datos."
          actions={<StatusBadge tone="info"><BarChart3 className="h-3.5 w-3.5" /> {rfqNumber}</StatusBadge>}
        />
      </ModuleSection>

      <section className="grid min-w-0 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard label="Renglones RFQ" value={items.length} hint="Cantidad de partidas detectadas" icon={Database} />
        <StatCard label="Cruce historico" value={loadingBatchHistory ? "..." : `${embeddedMatches}/${items.length}`} hint={batchHistoryReady ? "Matches automaticos del RFQ" : "Consultando historico por renglon"} icon={BarChart3} />
        <StatCard label="Referencia total" value={money(totalReference)} hint="Suma del mejor historico por renglon" icon={Target} />
        <StatCard label="Historico consultado" value={historicoRows.length} hint="Registros del renglon activo" icon={Search} />
      </section>

      {loadingBatchHistory ? (
        <section className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cruzando automáticamente los renglones del RFQ contra el histórico de precios...
        </section>
      ) : batchHistoryReady && items.length ? (
        <section className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Cruce histórico terminado: {embeddedMatches} de {items.length} renglones con referencia de precio.
        </section>
      ) : null}

      {error ? <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section> : null}

      {!items.length ? (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-6 text-sm leading-6 text-muted">
          No hay RFQ activo. Analiza un RFQ o abre un workspace guardado para activar la matriz de costos.
        </section>
      ) : (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
          <div className="min-w-0 rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Renglones del RFQ activo</div>
            <p className="mt-1 text-sm text-muted">Selecciona una partida para consultar su historico y referencia de precio.</p>

            <div className="mt-4 max-h-[720px] space-y-2 overflow-y-auto pr-1">
              {itemRows.map((row) => {
                const active = selectedIndex === row.index;
                return (
                  <button
                    type="button"
                    key={`${row.index}-${cleanValue(row.item.codigo_articulo, "")}`}
                    onClick={() => {
                      setSelectedIndex(row.index);
                      setManualSearch("");
                    }}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      active ? "border-blue-300 bg-blue-50 ring-2 ring-blue-100" : "border-line bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold leading-5 text-slate-900 line-clamp-2 break-words">{itemLabel(row.item, row.index)}</div>
                        <div className="mt-1 text-xs text-muted">Cant. {row.qty || "N/D"} | Mejor ref. {row.best ? money(row.best) : "Sin cruce"} | Registros {row.historyRows.length}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${row.hasHistoricalPrice ? "bg-emerald-50 text-emerald-700" : loadingBatchHistory ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                        {row.hasHistoricalPrice ? "Match" : loadingBatchHistory ? "Buscando" : "Sin match"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Renglon seleccionado</div>
                  <div className="mt-1 max-w-full break-words text-base font-semibold leading-6 text-brand">{selectedItem ? itemLabel(selectedItem, selectedIndex) : "Sin seleccion"}</div>
                </div>
                {loadingHistory ? <Loader2 className="h-5 w-5 animate-spin text-brand" /> : <Database className="h-5 w-5 text-brand" />}
              </div>

              <label className="relative mt-4 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={manualSearch}
                  onChange={(event) => setManualSearch(event.target.value)}
                  placeholder={`Busqueda historica: ${itemSearchTerm(selectedItem) || "codigo, descripcion o RFQ"}`}
                  className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                />
              </label>

              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                {insightCards.map(([label, value, Icon]) => (
                  <div key={String(label)} className="min-w-0 rounded-lg border border-line bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                      <Icon className="h-4 w-4 text-brand" />
                    </div>
                    <div className="mt-2 break-words text-lg font-semibold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  Criterio de lectura
                </div>
                <p className="mt-2 break-words text-sm leading-6 text-amber-900">
                  La referencia agresiva es una guia calculada desde el precio minimo historico. Debe validarse con proveedor, lead time, vigencia, logistica y cumplimiento tecnico antes de ofertar.
                </p>
              </div>
            </section>

            <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Historico relacionado</div>
                  <p className="mt-1 break-words text-sm text-muted">Resultados encontrados para la busqueda activa: {activeSearch || "N/D"}.</p>
                </div>
                <div className="text-sm font-semibold text-slate-700">{historicoRows.length} registros</div>
              </div>

              <div className="mt-4 rounded-lg border border-line bg-white">
                {historicoRows.length ? (
                  <div className="divide-y divide-line">
                    {historicoRows.map((row, index) => {
                      const record = row as Record<string, unknown>;
                      const proy = priceFrom(record, ["Precio Proyelec", "PRECIO PROYELEC", "precio_proyelec"]);
                      const comp = priceFrom(record, ["Precio Competencia", "PRECIO COMPETENCIA", "precio_competencia"]);
                      const licitacion = cell(record, ["N° Licitación", "N Licitacion", "N Licitación", "numero_licitacion"]);
                      const fechaHistorica = historicalDateLabel(record);
                      const codigo = cell(record, ["Código ACP", "Codigo ACP", "codigo_acp"]);
                      const cantidad = cell(record, ["Cantidad", "cantidad"]);
                      const ganador = cell(record, ["Adjudicada a Proyelec", "adjudicada_a_proyelec"], "N/D");
                      const analista = cell(record, ["Analista", "analista", "analista_procura"], "N/D");
                      const inicialEspecialista = specialistInitials(analista);
                      return (
                        <div key={index} className="grid min-w-0 gap-3 p-3 text-sm hover:bg-slate-50 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.78fr)_minmax(0,0.72fr)]">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-blue-800">Lic. {licitacion}</span>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">{fechaHistorica}</span>
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-800">Esp. {inicialEspecialista}</span>
                            </div>
                            <div className="mt-2 text-xs leading-5 text-muted">Especialista: {analista}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Código ACP / cantidad</div>
                            <div className="mt-1 break-words font-semibold text-slate-900">{codigo}</div>
                            <div className="mt-1 break-words text-xs text-muted">Cantidad histórica: {cantidad}</div>
                          </div>
                          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                            <div className="rounded-lg border border-line bg-slate-50 p-2">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Proyelec</div>
                              <div className="mt-1 font-semibold text-slate-900">{proy ? money(proy) : "N/D"}</div>
                            </div>
                            <div className="rounded-lg border border-line bg-slate-50 p-2">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Competencia</div>
                              <div className="mt-1 font-semibold text-slate-900">{comp ? money(comp) : "N/D"}</div>
                            </div>
                            <div className="min-w-0 rounded-lg border border-line bg-slate-50 p-2 sm:col-span-2 xl:col-span-1 2xl:col-span-2">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Ganador</div>
                              <div className="mt-1 break-words text-slate-800">{ganador}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 text-center text-sm text-muted">Sin registros historicos para esta busqueda.</div>
                )}
              </div>
            </section>
          </div>
        </section>
      )}
    </div>
  );
}









