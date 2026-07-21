"use client";

import { BarChart3, Check, Database, Loader2, Search, Target, TrendingDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AuthUser } from "@/lib/auth";
import { getHistorico, type HistoricoRow } from "@/lib/historico";
import {
  cleanValue,
  loadActiveRfqContext,
  loadLastRfq,
  type RfqAnalysisResponse,
  type RfqItem
} from "@/lib/rfq";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type CostRow = RfqItem & Record<string, unknown>;
type ItemHistoryMatch = { search: string; rows: HistoricoRow[]; error?: string };
type DisplayHistoryRow = { row: HistoricoRow; sourceIndexes: number[] };

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
  if (!Number.isFinite(value) || value <= 0) return "N/D";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
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
  const normalized = new Map(Object.keys(row).map((key) => [normalizeColumnName(key), key]));
  for (const key of keys) {
    const actual = normalized.get(normalizeColumnName(key));
    if (!actual) continue;
    const value = toNumber(row[actual]);
    if (value > 0) return value;
  }
  return 0;
}

function average(values: number[]) {
  const valid = values.filter((value) => value > 0);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
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

function specialistInitials(value: string) {
  const clean = cleanValue(value, "");
  if (!clean || clean === "N/D") return "-";
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token.charAt(0).toUpperCase())
    .join("") || "-";
}

function historicalDateLabel(record: Record<string, unknown>) {
  const exactDate = cell(record, ["Fecha", "fecha", "Fecha Licitación", "fecha_licitacion"], "");
  if (exactDate) return exactDate;
  const month = cell(record, ["Mes", "mes"], "");
  const year = cell(record, ["Año", "Ano", "anio"], "");
  if (month && year) return `${month} ${year}`;
  return month || year || "N/D";
}

function itemLabel(item: CostRow, index: number) {
  const line = cleanValue(item.renglon, String(index + 1));
  const code = cleanValue(item.codigo_articulo, "S/C");
  const description = cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "Sin descripción");
  return `Renglón ${line} | ${code} | ${description.slice(0, 76)}`;
}

function itemSearchTerm(item?: CostRow | null) {
  if (!item) return "";
  const code = cleanValue(item.codigo_articulo, "");
  if (code && code !== "No especificado") return code;
  return cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "");
}

function historySignature(row: HistoricoRow) {
  const record = row as Record<string, unknown>;
  return [
    cell(record, ["N° Licitación", "N Licitación", "N Licitacion", "numero_licitacion"]),
    historicalDateLabel(record),
    cell(record, ["Código ACP", "Codigo ACP", "codigo_acp"]),
    cell(record, ["Cantidad", "cantidad"]),
    priceFrom(record, ["Precio Proyelec", "precio_proyelec"]),
    priceFrom(record, ["Precio Competencia", "precio_competencia"])
  ].join("|");
}

export function CostAnalysisConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [manualSearch, setManualSearch] = useState("");
  const [manualRows, setManualRows] = useState<HistoricoRow[]>([]);
  const [itemHistoryMap, setItemHistoryMap] = useState<Record<number, ItemHistoryMatch>>({});
  const [loadingIndexes, setLoadingIndexes] = useState<number[]>([]);
  const [loadingManual, setLoadingManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingIndexesRef = useRef(new Set<number>());

  useEffect(() => {
    const saved = loadLastRfq(user.username);
    const context = loadActiveRfqContext(user.username);
    const savedItems = saved?.items || [];
    setRfq(saved);
    setItemHistoryMap({});
    loadingIndexesRef.current.clear();
    setLoadingIndexes([]);
    setManualSearch("");
    setManualRows([]);
    if (savedItems.length && context?.target_module === "costos") {
      const index = Math.min(Math.max(Number(context.item_index) || 0, 0), savedItems.length - 1);
      setSelectedIndexes([index]);
    } else {
      setSelectedIndexes(savedItems.length ? [0] : []);
    }
  }, [user.username]);

  const items = useMemo(() => (rfq?.items || []) as CostRow[], [rfq]);

  useEffect(() => {
    const targets = selectedIndexes
      .map((index) => ({ index, search: itemSearchTerm(items[index]) }))
      .filter((target) => target.search && !itemHistoryMap[target.index] && !loadingIndexesRef.current.has(target.index));

    if (!targets.length) return;
    targets.forEach((target) => loadingIndexesRef.current.add(target.index));
    setLoadingIndexes((current) => Array.from(new Set([...current, ...targets.map((target) => target.index)])));
    setError(null);

    Promise.all(
      targets.map(async (target): Promise<[number, ItemHistoryMatch]> => {
        try {
          const response = await getHistorico({ search: target.search, anio: "Todos", limit: 250 });
          return [target.index, { search: target.search, rows: response.rows || [] }];
        } catch (err) {
          return [
            target.index,
            { search: target.search, rows: [], error: err instanceof Error ? err.message : "Error consultando histórico" }
          ];
        }
      })
    ).then((entries) => {
      setItemHistoryMap((current) => ({ ...current, ...Object.fromEntries(entries) }));
      const firstError = entries.find(([, result]) => result.error)?.[1].error;
      if (firstError) setError(firstError);
      targets.forEach((target) => loadingIndexesRef.current.delete(target.index));
      setLoadingIndexes((current) => current.filter((index) => !targets.some((target) => target.index === index)));
    });
  }, [itemHistoryMap, items, selectedIndexes]);

  useEffect(() => {
    const search = manualSearch.trim();
    if (!search) {
      setManualRows([]);
      setLoadingManual(false);
      return;
    }
    let mounted = true;
    const timer = window.setTimeout(() => {
      setLoadingManual(true);
      setError(null);
      getHistorico({ search, anio: "Todos", limit: 500 })
        .then((response) => {
          if (mounted) setManualRows(response.rows || []);
        })
        .catch((err) => {
          if (!mounted) return;
          setManualRows([]);
          setError(err instanceof Error ? err.message : "No se pudo consultar el histórico de costos.");
        })
        .finally(() => {
          if (mounted) setLoadingManual(false);
        });
    }, 350);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [manualSearch]);

  const itemRows = useMemo(
    () => items.map((item, index) => {
      const quantity = toNumber(item.cantidad);
      const embeddedCompetition = priceFrom(item, ["precio_comp_hist", "PRECIO COMPETENCIA", "Precio Competencia", "precio_competencia"]);
      const embeddedProyelec = priceFrom(item, ["precio_proy_hist", "PRECIO PROYELEC", "Precio Proyelec", "precio_proyelec"]);
      const historyRows = itemHistoryMap[index]?.rows || [];
      const best = minPositive([embeddedCompetition, embeddedProyelec, ...historyPricesFromRows(historyRows)]);
      return {
        index,
        item,
        quantity,
        historyRows,
        best,
        referenceValue: quantity * best,
        hasMatch: historyRows.length > 0 || embeddedCompetition > 0 || embeddedProyelec > 0
      };
    }),
    [itemHistoryMap, items]
  );

  const selectedItemRows = itemRows.filter((row) => selectedIndexes.includes(row.index));
  const combinedRows = useMemo(() => {
    const combined = new Map<string, DisplayHistoryRow>();
    selectedItemRows.forEach((itemRow) => {
      itemRow.historyRows.forEach((row) => {
        const signature = historySignature(row);
        const current = combined.get(signature);
        if (current) {
          if (!current.sourceIndexes.includes(itemRow.index)) current.sourceIndexes.push(itemRow.index);
        } else {
          combined.set(signature, { row, sourceIndexes: [itemRow.index] });
        }
      });
    });
    return Array.from(combined.values());
  }, [selectedItemRows]);

  const manualMode = Boolean(manualSearch.trim());
  const displayedRows: DisplayHistoryRow[] = manualMode
    ? manualRows.map((row) => ({ row, sourceIndexes: [] }))
    : combinedRows;
  const selectedPrices = [
    ...historyPricesFromRows(combinedRows.map((entry) => entry.row)),
    ...selectedItemRows.flatMap((row) => [
      priceFrom(row.item, ["precio_comp_hist", "Precio Competencia", "precio_competencia"]),
      priceFrom(row.item, ["precio_proy_hist", "Precio Proyelec", "precio_proyelec"])
    ])
  ].filter((value) => value > 0);
  const summaryMin = manualMode ? minPositive(historyPricesFromRows(manualRows)) : minPositive(selectedPrices);
  const summaryAverage = manualMode ? average(historyPricesFromRows(manualRows)) : average(selectedPrices);
  const referenceTotal = selectedItemRows.reduce((sum, row) => sum + row.referenceValue, 0);
  const matchingItems = selectedItemRows.filter((row) => row.hasMatch).length;
  const isLoadingSelection = selectedIndexes.some((index) => loadingIndexes.includes(index));
  const rfqNumber = cleanValue(
    rfq?.condiciones_generales?.numero_licitacion || rfq?.condiciones_generales?.licitacion,
    "RFQ activo"
  );

  function toggleSelectedIndex(index: number) {
    setManualSearch("");
    setSelectedIndexes((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((a, b) => a - b)
    );
  }

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Comparativa de costos"
          title="Referencias históricas del RFQ"
          copy="Selecciona los renglones que vas a participar y compara sus precios anteriores sin mezclar partidas no elegidas."
          actions={
            <StatusBadge tone="info">
              <BarChart3 className="h-3.5 w-3.5" /> {rfqNumber}
            </StatusBadge>
          }
        />
      </ModuleSection>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {error}
        </div>
      ) : null}

      {!items.length ? (
        <ModuleSection>
          <EmptyState
            icon={Database}
            title="No hay un RFQ activo"
            copy="Analiza un RFQ o abre un espacio guardado para seleccionar renglones y compararlos con el histórico."
          />
        </ModuleSection>
      ) : (
        <>
          <ModuleSection className="p-0">
            <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
              {[
                ["Seleccionados", `${selectedIndexes.length} de ${items.length}`, "Renglones incluidos", Check],
                ["Con histórico", `${matchingItems} de ${selectedIndexes.length}`, "Coincidencias encontradas", Database],
                ["Precio mínimo", money(summaryMin), manualMode ? "Búsqueda manual" : "Selección actual", TrendingDown],
                ["Referencia total", money(referenceTotal), "Cantidad por mejor precio", Target]
              ].map(([label, value, hint, Icon]) => (
                <div key={String(label)} className="min-w-0 p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-muted">{String(label)}</span>
                    <Icon className="h-4 w-4 text-brand" />
                  </div>
                  <div className="mt-2 break-words text-xl font-semibold text-ink">{String(value)}</div>
                  <div className="mt-1 text-xs text-muted">{String(hint)}</div>
                </div>
              ))}
            </div>
          </ModuleSection>

          <div className="grid min-w-0 gap-5 2xl:grid-cols-[360px_minmax(0,1fr)]">
            <ModuleSection className="min-w-0 self-start">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-ink">Renglones a comparar</h2>
                  <p className="mt-1 text-sm leading-5 text-muted">Marca solamente las partidas que vas a evaluar.</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIndexes(items.map((_, index) => index))}>
                    Todos
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIndexes([])}>
                    Limpiar
                  </Button>
                </div>
              </div>

              <div className="mt-4 max-h-[640px] space-y-2 overflow-y-auto pr-1">
                {itemRows.map((row) => {
                  const checked = selectedIndexes.includes(row.index);
                  const loading = loadingIndexes.includes(row.index);
                  const failed = Boolean(itemHistoryMap[row.index]?.error);
                  return (
                    <label
                      key={`${row.index}-${cleanValue(row.item.codigo_articulo, "")}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                        checked
                          ? "border-blue-300 bg-blue-50 text-blue-950"
                          : "border-line bg-panel text-ink hover:border-blue-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedIndex(row.index)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-5">{itemLabel(row.item, row.index)}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted">
                          Cant. {cleanValue(row.item.cantidad, "N/D")} · Mejor ref. {money(row.best)}
                        </span>
                      </span>
                      <span className="shrink-0 pt-0.5">
                        {loading ? (
                          <Loader2 className="h-4 w-4 animate-spin text-brand" />
                        ) : failed ? (
                          <StatusBadge tone="danger">Error</StatusBadge>
                        ) : row.hasMatch ? (
                          <StatusBadge tone="ok">Match</StatusBadge>
                        ) : itemHistoryMap[row.index] ? (
                          <StatusBadge tone="neutral">Sin datos</StatusBadge>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </ModuleSection>

            <div className="min-w-0 space-y-5">
              <ModuleSection>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-ink">
                      {manualMode ? "Resultados de búsqueda" : "Histórico de la selección"}
                    </h2>
                    <p className="mt-1 text-sm leading-5 text-muted">
                      {manualMode
                        ? `Buscando coincidencias para “${manualSearch.trim()}”.`
                        : "Los registros repetidos entre varios renglones se muestran una sola vez."}
                    </p>
                  </div>
                  <StatusBadge tone={displayedRows.length ? "info" : "neutral"}>
                    {displayedRows.length} registros
                  </StatusBadge>
                </div>

                <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row">
                  <label className="relative min-w-0 flex-1">
                    <span className="sr-only">Buscar otra referencia histórica</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      value={manualSearch}
                      onChange={(event) => setManualSearch(event.target.value)}
                      placeholder="Buscar otro código ACP, producto o licitación"
                      className="app-input h-11 w-full min-w-0 pl-9 pr-3 text-sm"
                    />
                  </label>
                  {manualMode ? (
                    <Button type="button" variant="secondary" onClick={() => setManualSearch("")}>
                      Volver a selección
                    </Button>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-muted">Promedio histórico</div>
                    <div className="mt-1 text-lg font-semibold text-ink">{money(summaryAverage)}</div>
                  </div>
                  <div className="rounded-lg border border-line bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-muted">Criterio</div>
                    <div className="mt-1 text-sm leading-6 text-ink">
                      Referencia real; valida vigencia, logística y cumplimiento técnico antes de ofertar.
                    </div>
                  </div>
                </div>
              </ModuleSection>

              <ModuleSection className="min-w-0 p-0">
                {isLoadingSelection || loadingManual ? (
                  <div className="flex min-h-40 items-center justify-center gap-2 p-6 text-sm font-semibold text-brand">
                    <Loader2 className="h-4 w-4 animate-spin" /> Consultando histórico...
                  </div>
                ) : !selectedIndexes.length && !manualMode ? (
                  <div className="p-5">
                    <EmptyState
                      icon={BarChart3}
                      title="Selecciona al menos un renglón"
                      copy="La comparación combinada se actualizará automáticamente con las partidas elegidas."
                    />
                  </div>
                ) : !displayedRows.length ? (
                  <div className="p-5">
                    <EmptyState
                      icon={Search}
                      title="No se encontraron referencias"
                      copy="Prueba con otro código ACP o una descripción más corta. No se calcularán precios sin datos históricos."
                    />
                  </div>
                ) : (
                  <>
                    <div className="hidden min-w-0 overflow-hidden lg:block">
                      <table className="app-table w-full table-fixed text-left text-xs">
                        <thead>
                          <tr>
                            <th className="w-[22%] p-3">Licitación y fecha</th>
                            <th className="w-[23%] p-3">Producto histórico</th>
                            <th className="w-[24%] p-3">Precios unitarios</th>
                            <th className="w-[20%] p-3">Resultado</th>
                            <th className="w-[11%] p-3">Especialista</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayedRows.map((entry, index) => {
                            const record = entry.row as Record<string, unknown>;
                            const licitacion = cell(record, ["N° Licitación", "N Licitación", "N Licitacion", "numero_licitacion"]);
                            const date = historicalDateLabel(record);
                            const code = cell(record, ["Código ACP", "Codigo ACP", "codigo_acp"]);
                            const quantity = cell(record, ["Cantidad", "cantidad"]);
                            const proyelec = priceFrom(record, ["Precio Proyelec", "PRECIO PROYELEC", "precio_proyelec"]);
                            const competition = priceFrom(record, ["Precio Competencia", "PRECIO COMPETENCIA", "precio_competencia"]);
                            const winner = cell(record, ["Adjudicada a Proyelec", "adjudicada_a_proyelec"], "N/D");
                            const specialist = cell(record, ["Analista", "analista", "analista_procura"], "N/D");
                            return (
                              <tr key={`${historySignature(entry.row)}-${index}`}>
                                <td className="break-words p-3 align-top">
                                  <div className="font-semibold text-ink">{licitacion}</div>
                                  <div className="mt-1 text-muted">{date}</div>
                                  {entry.sourceIndexes.length ? (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {entry.sourceIndexes.map((sourceIndex) => (
                                        <StatusBadge key={sourceIndex} tone="info">
                                          R{cleanValue(items[sourceIndex]?.renglon, String(sourceIndex + 1))}
                                        </StatusBadge>
                                      ))}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="break-words p-3 align-top">
                                  <div className="font-semibold text-ink">{code}</div>
                                  <div className="mt-1 text-muted">Cantidad: {quantity}</div>
                                </td>
                                <td className="break-words p-3 align-top">
                                  <div><span className="text-muted">Proyelec:</span> <span className="font-semibold text-ink">{money(proyelec)}</span></div>
                                  <div className="mt-1"><span className="text-muted">Competencia:</span> <span className="font-semibold text-ink">{money(competition)}</span></div>
                                </td>
                                <td className="break-words p-3 align-top text-ink">{winner}</td>
                                <td className="break-words p-3 align-top">
                                  <StatusBadge tone="neutral">{specialistInitials(specialist)}</StatusBadge>
                                  <div className="mt-2 text-muted">{specialist}</div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="divide-y divide-line lg:hidden">
                      {displayedRows.map((entry, index) => {
                        const record = entry.row as Record<string, unknown>;
                        const licitacion = cell(record, ["N° Licitación", "N Licitación", "N Licitacion", "numero_licitacion"]);
                        const code = cell(record, ["Código ACP", "Codigo ACP", "codigo_acp"]);
                        const proyelec = priceFrom(record, ["Precio Proyelec", "precio_proyelec"]);
                        const competition = priceFrom(record, ["Precio Competencia", "precio_competencia"]);
                        const specialist = cell(record, ["Analista", "analista", "analista_procura"], "N/D");
                        return (
                          <article key={`${historySignature(entry.row)}-mobile-${index}`} className="p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-semibold text-ink">Licitación {licitacion}</div>
                              <StatusBadge tone="neutral">{historicalDateLabel(record)}</StatusBadge>
                            </div>
                            <div className="mt-3 text-sm font-semibold text-ink">{code}</div>
                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                              <div><div className="text-xs text-muted">Proyelec</div><div className="mt-1 font-semibold text-ink">{money(proyelec)}</div></div>
                              <div><div className="text-xs text-muted">Competencia</div><div className="mt-1 font-semibold text-ink">{money(competition)}</div></div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                              <span>Esp. {specialistInitials(specialist)}</span>
                              {entry.sourceIndexes.map((sourceIndex) => (
                                <StatusBadge key={sourceIndex} tone="info">
                                  R{cleanValue(items[sourceIndex]?.renglon, String(sourceIndex + 1))}
                                </StatusBadge>
                              ))}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
              </ModuleSection>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
