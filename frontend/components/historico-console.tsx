"use client";

import { BarChart3, Database, Loader2, Search, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getHistorico, type HistoricoRow } from "@/lib/historico";
import { type AuthUser } from "@/lib/auth";

const columns = [
  "N° Licitación",
  "Año",
  "Mes",
  "Código ACP",
  "Cantidad",
  "Precio Proyelec",
  "Precio Competencia",
  "Adjudicada a Proyelec",
  "Analista",
  "Observaciones"
];

const aliases: Record<string, string[]> = {
  "N° Licitación": ["N° Licitación", "N° Licitacion", "Nº Licitación", "numero_licitacion"],
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

export function HistoricoConsole({ user }: { user: AuthUser }) {
  const [rows, setRows] = useState<HistoricoRow[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [anio, setAnio] = useState("Todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      getHistorico({ search, anio, limit: 500 })
        .then((response) => {
          if (!mounted) return;
          setRows(response.rows || []);
          setYears(response.years || []);
          setCount(response.count || 0);
        })
        .catch((err) => {
          if (mounted) setError(err instanceof Error ? err.message : "No se pudo cargar el historico.");
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    }, 250);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [search, anio]);

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
      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-brand">Historico Supabase</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Precios y participaciones anteriores</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Consulta el historico corporativo para comparar precios, detectar participaciones anteriores y alimentar decisiones del Radar.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <Database className="h-4 w-4 text-brand" />
            {count.toLocaleString()} registros
          </div>
        </div>
      </section>

      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}

      <section className="grid gap-3 md:grid-cols-4">
        {[
          ["Mostrando", String(summary.shown), "Registros del filtro actual", Database],
          ["Ganadas", String(summary.won), "Adjudicadas a Proyelec/EP", Trophy],
          ["Precio min.", moneyCell(summary.min), "Referencia Proyelec", BarChart3],
          ["Promedio", moneyCell(summary.avg), "Solo registros con precio", BarChart3]
        ].map(([label, value, hint, Icon]) => (
          <div key={String(label)} className="rounded-xl border border-line bg-panel p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{String(label)}</div>
              <Icon className="h-4 w-4 text-brand" />
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{String(value)}</div>
            <div className="mt-1 text-xs text-muted">{String(hint)}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 rounded-xl border border-line bg-panel p-5 shadow-sm lg:grid-cols-[1fr_0.35fr]">
        <label className="grid gap-2 text-sm font-semibold text-slate-800">
          Buscar
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="RFQ, codigo ACP, marca, proveedor u observacion"
              className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none"
            />
          </div>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-800">
          Ano
          <select value={anio} onChange={(event) => setAnio(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none">
            <option value="Todos">Todos</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Resultados</div>
            <p className="mt-1 text-sm text-muted">Estos datos son los que el Radar usa para sugerir antecedentes.</p>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <table className="w-full table-fixed divide-y divide-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <tr>
                {columns.map((header) => (
                  <th key={header} className="px-3 py-3">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {rows.map((row, index) => (
                <tr key={index} className="hover:bg-slate-50">
                  {columns.map((key) => {
                    const value = key === "Precio Proyelec" || key === "Precio Competencia" ? moneyCell(rawCell(row, key)) : cell(row, key);
                    return (
                      <td key={key} className="max-w-[280px] px-3 py-3 text-slate-800">
                        <span className={key === "Observaciones" ? "line-clamp-2" : ""}>{value}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="px-3 py-5 text-muted" colSpan={columns.length}>Sin resultados para el filtro actual.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
