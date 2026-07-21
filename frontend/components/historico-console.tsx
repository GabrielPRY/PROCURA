"use client";

import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Database,
  FileSearch,
  Loader2,
  Search,
  Trophy,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getHistorico, type HistoricoRow } from "@/lib/historico";
import { type AuthUser } from "@/lib/auth";
import { cleanValue, loadLastRfq, type RfqItem } from "@/lib/rfq";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type SortMode = "recent" | "lowest" | "won";
type OutcomeFilter = "all" | "won" | "reference";

function normalizeKey(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function rawCell(row: HistoricoRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  const normalizedColumns = new Map(Object.keys(row).map((key) => [normalizeKey(key), key]));
  for (const key of keys) {
    const actual = normalizedColumns.get(normalizeKey(key));
    if (!actual) continue;
    const value = row[actual];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return "";
}

function cell(row: HistoricoRow, keys: string[], fallback = "N/D") {
  return cleanValue(rawCell(row, keys), fallback);
}

function numberCell(row: HistoricoRow, keys: string[]) {
  const value = rawCell(row, keys);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "N/D";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function parseSearchTerms(value: string) {
  return [...new Set(String(value || "").split(/[\n,;|]+/).map((term) => term.trim()).filter(Boolean))].slice(0, 12);
}

function isWon(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "si" || text === "sí" || text === "ep" || text.includes("proyelec");
}

function licitation(row: HistoricoRow) {
  return cell(row, ["N° Licitación", "N° Licitacion", "N Licitación", "numero_licitacion"]);
}

function code(row: HistoricoRow) {
  return cell(row, ["Código ACP", "Codigo ACP", "codigo_acp"]);
}

function year(row: HistoricoRow) {
  return cell(row, ["Año", "Ano", "anio"], "");
}

function period(row: HistoricoRow) {
  const month = cell(row, ["Mes", "mes"], "");
  const rowYear = year(row);
  return [month, rowYear].filter(Boolean).join(" ") || "N/D";
}

function proyelecPrice(row: HistoricoRow) {
  return numberCell(row, ["Precio Proyelec", "PRECIO PROYELEC", "precio_proyelec"]);
}

function competitionPrice(row: HistoricoRow) {
  return numberCell(row, ["Precio Competencia", "PRECIO COMPETENCIA", "precio_competencia"]);
}

function wonRow(row: HistoricoRow) {
  return isWon(rawCell(row, ["Adjudicada a Proyelec", "adjudicada_a_proyelec"]));
}

function rowSignature(row: HistoricoRow) {
  return [licitation(row), period(row), code(row), cell(row, ["Cantidad", "cantidad"]), proyelecPrice(row), competitionPrice(row)].join("|");
}

function specialistInitials(value: string) {
  const cleaned = cleanValue(value, "");
  if (!cleaned) return "-";
  return cleaned.split(/\s+/).filter(Boolean).slice(0, 2).map((token) => token[0]?.toUpperCase()).join("") || "-";
}

function itemSearchTerm(item: RfqItem) {
  const itemCode = cleanValue(item.codigo_articulo, "");
  if (itemCode && !itemCode.toLowerCase().includes("no especificado")) return itemCode;
  return cleanValue(item.termino_de_busqueda_corto || item.descripcion, "");
}

function priceDifference(row: HistoricoRow) {
  const own = proyelecPrice(row);
  const competition = competitionPrice(row);
  if (!own || !competition) return null;
  return competition - own;
}

export function HistoricoConsole({ user }: { user: AuthUser }) {
  const [rows, setRows] = useState<HistoricoRow[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [query, setQuery] = useState("");
  const [activeTerms, setActiveTerms] = useState<string[]>([]);
  const [anio, setAnio] = useState("Todos");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rfqTerms, setRfqTerms] = useState<string[]>([]);

  async function loadHistory(terms: string[], selectedYear = anio) {
    setLoading(true);
    setError(null);
    try {
      const response = await getHistorico({ terms, anio: selectedYear, limit: terms.length ? 600 : 150 });
      setRows(response.rows || []);
      setYears(response.years || []);
      setTotalCount(response.count || 0);
      setMatchedCount(response.matched_count ?? (response.rows || []).length);
    } catch (err) {
      setRows([]);
      setMatchedCount(0);
      setError(err instanceof Error ? err.message : "No se pudo cargar el histórico.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const rfq = loadLastRfq(user.username);
    const terms = [...new Set((rfq?.items || []).map(itemSearchTerm).filter(Boolean))].slice(0, 12);
    setRfqTerms(terms);
    loadHistory([], "Todos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.username]);

  function submitSearch(event?: FormEvent) {
    event?.preventDefault();
    const terms = parseSearchTerms(query);
    setActiveTerms(terms);
    setExpanded(null);
    loadHistory(terms, anio);
  }

  function useRfqTerms() {
    setQuery(rfqTerms.join("\n"));
    setActiveTerms(rfqTerms);
    setExpanded(null);
    loadHistory(rfqTerms, anio);
  }

  function removeTerm(term: string) {
    const next = activeTerms.filter((value) => value !== term);
    setActiveTerms(next);
    setQuery(next.join("\n"));
    setExpanded(null);
    loadHistory(next, anio);
  }

  function changeYear(value: string) {
    setAnio(value);
    setExpanded(null);
    loadHistory(activeTerms, value);
  }

  const displayedRows = useMemo(() => {
    const filtered = rows.filter((row) => outcome === "all" || (outcome === "won" ? wonRow(row) : !wonRow(row)));
    return [...filtered].sort((a, b) => {
      if (sortMode === "lowest") {
        const aPrice = proyelecPrice(a) || Number.MAX_SAFE_INTEGER;
        const bPrice = proyelecPrice(b) || Number.MAX_SAFE_INTEGER;
        return aPrice - bPrice;
      }
      if (sortMode === "won") return Number(wonRow(b)) - Number(wonRow(a));
      const yearDifference = Number(year(b) || 0) - Number(year(a) || 0);
      if (yearDifference) return yearDifference;
      return Number(licitation(b).replace(/\D/g, "") || 0) - Number(licitation(a).replace(/\D/g, "") || 0);
    });
  }, [rows, outcome, sortMode]);

  const summary = useMemo(() => {
    const ownPrices = displayedRows.map(proyelecPrice).filter((value) => value > 0);
    const competitionPrices = displayedRows.map(competitionPrice).filter((value) => value > 0);
    return {
      won: displayedRows.filter(wonRow).length,
      minOwn: ownPrices.length ? Math.min(...ownPrices) : 0,
      minCompetition: competitionPrices.length ? Math.min(...competitionPrices) : 0
    };
  }, [displayedRows]);

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Memoria corporativa"
          title="Histórico de precios y participaciones"
          copy="Busca licitaciones, códigos ACP o productos y compara los resultados que ya conoce la empresa."
          actions={<StatusBadge tone="info"><Database className="h-3.5 w-3.5" />{totalCount.toLocaleString()} registros en Supabase</StatusBadge>}
        />
      </ModuleSection>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}</div> : null}

      <ModuleSection>
        <form onSubmit={submitSearch}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div><h2 className="text-base font-semibold text-ink">¿Qué quieres comparar?</h2><p className="mt-1 text-sm leading-6 text-muted">Acepta hasta 12 términos separados por coma o salto de línea.</p></div>
            {rfqTerms.length ? <Button type="button" variant="secondary" size="sm" onClick={useRfqTerms}><FileSearch className="h-4 w-4" />Usar {rfqTerms.length} renglones del RFQ</Button> : null}
          </div>

          <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_150px_auto]">
            <label className="relative min-w-0">
              <span className="sr-only">Términos de búsqueda</span>
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted" />
              <textarea value={query} onChange={(event) => setQuery(event.target.value)} rows={2} className="app-input min-h-20 resize-y py-3 pl-9" placeholder="HYD-COM-00927, 213889, bombas de diafragma" />
            </label>
            <label className="min-w-0"><span className="sr-only">Año</span><select value={anio} onChange={(event) => changeYear(event.target.value)} className="app-input"><option value="Todos">Todos los años</option>{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <Button type="submit" variant="primary" size="lg" className="self-start" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{loading ? "Buscando..." : "Buscar histórico"}</Button>
          </div>
        </form>

        {activeTerms.length ? <div className="mt-4 flex flex-wrap gap-2">{activeTerms.map((term) => <button key={term} type="button" onClick={() => removeTerm(term)} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-brand transition hover:border-blue-400" title={`Quitar ${term}`}>{term}<X className="h-3 w-3" /></button>)}</div> : <p className="mt-3 text-xs text-muted">Sin filtros: se muestran los registros más recientes.</p>}
      </ModuleSection>

      <ModuleSection className="p-0">
        <div className="grid grid-cols-2 divide-x divide-line border-b border-line sm:grid-cols-4">
          <div className="p-4"><div className="text-xs font-semibold text-muted">Coincidencias</div><div className="mt-1 text-xl font-semibold text-ink">{matchedCount.toLocaleString()}</div></div>
          <div className="p-4"><div className="text-xs font-semibold text-muted">Ganadas visibles</div><div className="mt-1 text-xl font-semibold text-ink">{summary.won}</div></div>
          <div className="border-t border-line p-4 sm:border-t-0"><div className="text-xs font-semibold text-muted">Mínimo Proyelec</div><div className="mt-1 text-xl font-semibold text-ink">{money(summary.minOwn)}</div></div>
          <div className="border-t border-line p-4 sm:border-t-0"><div className="text-xs font-semibold text-muted">Mínimo competencia</div><div className="mt-1 text-xl font-semibold text-ink">{money(summary.minCompetition)}</div></div>
        </div>

        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-semibold text-ink">Resultados</h2><p className="mt-1 text-xs text-muted">{displayedRows.length} registros visibles de {matchedCount} coincidencias.</p></div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <select value={outcome} onChange={(event) => setOutcome(event.target.value as OutcomeFilter)} className="app-input h-10 min-w-0 sm:w-40"><option value="all">Todos los resultados</option><option value="won">Solo ganadas</option><option value="reference">Solo referencias</option></select>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="app-input h-10 min-w-0 sm:w-44"><option value="recent">Más recientes</option><option value="lowest">Menor precio Proyelec</option><option value="won">Ganadas primero</option></select>
          </div>
        </div>

        {loading ? <div className="grid min-h-52 place-items-center border-t border-line"><div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin text-brand" />Consultando Supabase...</div></div> : displayedRows.length ? (
          <div className="border-t border-line">
            <div className="hidden grid-cols-[120px_130px_minmax(130px,1fr)_90px_125px_125px_100px_44px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold text-muted lg:grid">
              <span>Licitación</span><span>Fecha</span><span>Código ACP</span><span>Cantidad</span><span>Proyelec</span><span>Competencia</span><span>Resultado</span><span />
            </div>
            <div className="divide-y divide-line">
              {displayedRows.map((row, index) => {
                const signature = `${rowSignature(row)}-${index}`;
                const won = wonRow(row);
                const analyst = cell(row, ["Analista", "analista_procura"]);
                const observation = cell(row, ["Observaciones", "observaciones"], "Sin observaciones registradas.");
                const difference = priceDifference(row);
                const isExpanded = expanded === signature;
                return (
                  <article key={signature} className="bg-panel transition hover:bg-slate-50">
                    <div className="hidden grid-cols-[120px_130px_minmax(130px,1fr)_90px_125px_125px_100px_44px] items-center gap-3 px-4 py-3 lg:grid">
                      <div className="break-words text-sm font-semibold text-ink">{licitation(row)}</div>
                      <div className="text-sm text-muted">{period(row)}<div className="mt-1 text-xs">Esp. {specialistInitials(analyst)}</div></div>
                      <div className="min-w-0 break-words text-sm font-semibold text-ink">{code(row)}</div>
                      <div className="text-sm text-ink">{cell(row, ["Cantidad", "cantidad"])}</div>
                      <div className="text-sm font-semibold text-ink">{money(proyelecPrice(row))}</div>
                      <div className="text-sm text-ink">{money(competitionPrice(row))}{difference !== null ? <div className={`mt-1 text-xs ${difference >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{difference >= 0 ? `${money(difference)} por encima` : `${money(Math.abs(difference))} por debajo`}</div> : null}</div>
                      <StatusBadge tone={won ? "ok" : "neutral"}>{won ? "Ganada" : "Referencia"}</StatusBadge>
                      <Button type="button" variant="ghost" size="icon" onClick={() => setExpanded(isExpanded ? null : signature)} title={isExpanded ? "Ocultar detalle" : "Ver detalle"}>{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
                    </div>

                    <div className="p-4 lg:hidden">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-sm font-semibold text-ink">Lic. {licitation(row)}</div><div className="mt-1 break-words text-sm text-muted">{code(row)}</div></div><StatusBadge tone={won ? "ok" : "neutral"}>{won ? "Ganada" : "Referencia"}</StatusBadge></div>
                      <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-lg border border-line bg-slate-50 p-3"><div className="text-xs text-muted">Proyelec</div><div className="mt-1 text-sm font-semibold text-ink">{money(proyelecPrice(row))}</div></div><div className="rounded-lg border border-line bg-slate-50 p-3"><div className="text-xs text-muted">Competencia</div><div className="mt-1 text-sm font-semibold text-ink">{money(competitionPrice(row))}</div></div></div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted"><span>{period(row)} · Cant. {cell(row, ["Cantidad", "cantidad"])} · Esp. {specialistInitials(analyst)}</span><Button type="button" variant="ghost" size="icon" onClick={() => setExpanded(isExpanded ? null : signature)}>{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button></div>
                    </div>

                    {isExpanded ? <div className="border-t border-line bg-slate-50 px-4 py-4"><div className="grid gap-3 md:grid-cols-[1fr_220px]"><div><div className="text-xs font-semibold text-muted">Observaciones</div><p className="mt-1 text-sm leading-6 text-ink">{observation}</p></div><div><div className="text-xs font-semibold text-muted">Especialista</div><div className="mt-1 text-sm font-semibold text-ink">{analyst}</div></div></div></div> : null}
                  </article>
                );
              })}
            </div>
          </div>
        ) : <div className="border-t border-line p-5"><EmptyState icon={BarChart3} title="No encontramos antecedentes" copy="Prueba con el código ACP exacto, número de licitación o una descripción más corta." /></div>}
      </ModuleSection>
    </div>
  );
}
