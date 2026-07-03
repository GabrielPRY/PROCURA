"use client";

import { BarChart3, Database, Loader2, Search, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getHistorico, type HistoricoRow } from "@/lib/historico";
import { type AuthUser } from "@/lib/auth";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";

const aliases: Record<string, string[]> = {
  "N° Licitación": ["N° Licitación", "N° Licitacion", "N° Licitación", "numero_licitacion"],
  "Año": ["Año", "Ano", "anio"],
  "Mes": ["Mes", "mes"],
  "Código ACP": ["Código ACP", "Codigo ACP", "codigo_acp"],
  "Cantidad": ["Cantidad", "cantidad"],
  "Precio Proyelec": ["Precio Proyelec", "precio_proyelec"],
  "Precio Competencia": ["Precio Competencia", "precio_competencia"],
  "Adjudicada a Proyelec": ["Adjudicada a Proyelec", "adjudicada_a_proyelec"],
  "Analista": ["Analista", "analista_procura"],
  "Observaciones": ["Observaciones", "observaciones"]
};

function rawCell(row: HistoricoRow, key: string) {
  const keys = aliases[key] || [key];
  for (const candidate of keys) {
    const value = row[candidate];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return "";
}

function cell(row: HistoricoRow, key: string) {
  const value = rawCell(row, key);
  if (value === null || value === undefined || value === "") return "N/D";
  return String(value);
}

function moneyCell(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "N/D";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(parsed);
}

function isWon(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  return text.includes("si") || text.includes("proyelec") || text.trim() === "ep";
}

function parseSearchTerms(value: string) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\n,;|]+/)
        .map((term) => term.trim())
        .filter(Boolean)
    )
  ).slice(0, 12);
}

function rowSignature(row: HistoricoRow) {
  return [
    cell(row, "N° Licitación"),
    cell(row, "Año"),
    cell(row, "Mes"),
    cell(row, "Código ACP"),
    cell(row, "Cantidad"),
    moneyCell(rawCell(row, "Precio Proyelec")),
    moneyCell(rawCell(row, "Precio Competencia"))
  ].join("|");
}

function periodLabel(row: HistoricoRow) {
  const month = cell(row, "Mes");
  const year = cell(row, "Año");
  if (month !== "N/D" && year !== "N/D") return `${month} ${year}`;
  return month !== "N/D" ? month : year;
}

function specialistInitials(value: string) {
  const clean = String(value || "").trim();
  if (!clean || clean === "N/D") return "-";
  return clean.split(/\s+/).slice(0, 2).map((token) => token.charAt(0).toUpperCase()).join("") || "-";
}

export function HistoricoConsole({ user }: { user: AuthUser }) {
  const [rows, setRows] = useState<HistoricoRow[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [anio, setAnio] = useState("Todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchTerms = useMemo(() => parseSearchTerms(search), [search]);
  const isMultiSearch = searchTerms.length > 1;

  useEffect(() => {
    let mounted = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      const load = async () => {
        if (isMultiSearch) {
          const responses = await Promise.all(searchTerms.map((term) => getHistorico({ search: term, anio, limit: 250 })));
          const seen = new Set<string>();
          const combinedRows: HistoricoRow[] = [];
          const combinedYears = new Set<number>();
          let combinedCount = 0;

          responses.forEach((response) => {
            combinedCount += response.count || 0;
            (response.years || []).forEach((year) => combinedYears.add(year));
            (response.rows || []).forEach((row) => {
              const signature = rowSignature(row);
              if (seen.has(signature)) return;
              seen.add(signature);
              combinedRows.push(row);
            });
          });

          return { rows: combinedRows, years: Array.from(combinedYears).sort((a, b) => b - a), count: combinedCount };
        }

        const response = await getHistorico({ search, anio, limit: 500 });
        return { rows: response.rows || [], years: response.years || [], count: response.count || 0 };
      };

      load()
        .then((response) => {
          if (!mounted) return;
          setRows(response.rows);
          setYears(response.years);
          setCount(response.count);
        })
        .catch((err) => {
          if (mounted) setError(err instanceof Error ? err.message : "No se pudo cargar el historico.");
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    }, 300);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [search, anio, isMultiSearch, searchTerms]);

  const summary = useMemo(() => {
    const prices = rows
      .map((row) => Number(rawCell(row, "Precio Proyelec")))
      .filter((value) => Number.isFinite(value) && value > 0);
    return {
      shown: rows.length,
      won: rows.filter((row) => isWon(rawCell(row, "Adjudicada a Proyelec"))).length,
      min: prices.length ? Math.min(...prices) : 0,
      avg: prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : 0
    };
  }, [rows]);

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Historico Supabase"
          title="Precios y participaciones anteriores"
          copy="Consulta el historico corporativo por licitacion, codigo ACP o producto. Puedes buscar varios terminos a la vez para comparar renglones seleccionados."
          actions={<StatusBadge tone="info"><Database className="h-3.5 w-3.5" /> {count.toLocaleString()} registros</StatusBadge>}
        />
      </ModuleSection>

      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}

      <section className="grid gap-3 md:grid-cols-4">
        <StatCard label="Mostrando" value={summary.shown} hint="Registros visibles" icon={Database} />
        <StatCard label="Ganadas" value={summary.won} hint="Adjudicadas a Proyelec/EP" icon={Trophy} />
        <StatCard label="Precio min." value={moneyCell(summary.min)} hint="Referencia Proyelec" icon={BarChart3} />
        <StatCard label="Promedio" value={moneyCell(summary.avg)} hint="Solo registros con precio" icon={BarChart3} />
      </section>

      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Busqueda historica</div>
            <p className="mt-1 text-sm text-muted">Pega uno o varios codigos ACP, numeros de licitacion o productos. Separalos por coma o salto de linea.</p>
          </div>
          {isMultiSearch ? <StatusBadge tone="info">{searchTerms.length} busquedas</StatusBadge> : null}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px]">
          <label className="grid gap-2 text-sm font-semibold text-slate-800">
            Terminos de busqueda
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
              <textarea
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                rows={3}
                placeholder="Ej: HYD-COM-00927, 213889, grasa lubricante, bombas de diafragma"
                className="min-h-24 w-full resize-y rounded-lg border border-line bg-white py-3 pl-9 pr-3 text-sm leading-6 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </label>
          <label className="grid content-start gap-2 text-sm font-semibold text-slate-800">
            Año
            <select value={anio} onChange={(event) => setAnio(event.target.value)} className="app-input">
              <option value="Todos">Todos</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setSearch("")} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-brand">
              Limpiar busqueda
            </button>
          </label>
        </div>

        {searchTerms.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {searchTerms.map((term) => (
              <span key={term} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-brand">{term}</span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Resultados historicos</div>
            <p className="mt-1 text-sm text-muted">Lectura compacta para comparar precio, participacion, analista y antecedentes.</p>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <StatusBadge tone="info">{rows.length} visibles</StatusBadge>}
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {rows.map((row, index) => {
            const won = isWon(rawCell(row, "Adjudicada a Proyelec"));
            const analyst = cell(row, "Analista");
            return (
              <article key={`${rowSignature(row)}-${index}`} className="rounded-xl border border-line bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-800">Lic. {cell(row, "N° Licitación")}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">{periodLabel(row)}</span>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800">Esp. {specialistInitials(analyst)}</span>
                    </div>
                    <div className="mt-3 break-words text-base font-semibold text-slate-950">{cell(row, "Código ACP")}</div>
                    <div className="mt-1 text-sm text-muted">Cantidad: {cell(row, "Cantidad")} | Analista: {analyst}</div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${won ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                    {won ? "Ganada" : "Referencia"}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Precio Proyelec</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{moneyCell(rawCell(row, "Precio Proyelec"))}</div>
                  </div>
                  <div className="rounded-lg border border-line bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Precio competencia</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{moneyCell(rawCell(row, "Precio Competencia"))}</div>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">Observaciones</div>
                  <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-700">{cell(row, "Observaciones")}</p>
                </div>
              </article>
            );
          })}
          {!rows.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-muted xl:col-span-2">
              Sin resultados para el filtro actual. Prueba con codigo ACP, numero de licitacion o una descripcion mas corta.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
