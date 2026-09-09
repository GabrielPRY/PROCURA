"use client";

import { Activity, AlertTriangle, BarChart3, CircleDollarSign, Loader2, RefreshCw, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { getUsageMetrics, type UsageOptions, type UsageSummary } from "@/lib/metrics";
import { type AuthUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  }).format(numberValue(value));
}

function shortDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return String(value || "N/D");
  return new Intl.DateTimeFormat("es-PA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function TopTable({ title, rows, columns }: { title: string; rows: Array<Record<string, unknown>>; columns: string[] }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        {rows.length ? (
          <div className="divide-y divide-line">
            {rows.slice(0, 8).map((row, index) => (
              <div key={index} className="grid gap-3 bg-white p-3 text-sm md:grid-cols-3">
                {columns.map((column) => (
                  <div key={column}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">{column}</div>
                    <div className="mt-1 font-semibold text-slate-900">{String(row[column] ?? "N/D")}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-50 p-5 text-sm text-muted">Sin datos para este filtro.</div>
        )}
      </div>
    </div>
  );
}

export function MetricsConsole({ user }: { user: AuthUser }) {
  const [days, setDays] = useState(30);
  const [username, setUsername] = useState("Todos");
  const [module, setModule] = useState("Todos");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [options, setOptions] = useState<UsageOptions>({ users: ["Todos"], modules: ["Todos"] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    getUsageMetrics({ days, username, module })
      .then((response) => {
        if (!mounted) return;
        setSummary(response.summary);
        setOptions(response.options || { users: ["Todos"], modules: ["Todos"] });
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : "No se pudieron cargar las metricas.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [days, username, module, refreshTick]);

  const errorRate = numberValue(summary?.total_events) ? (numberValue(summary?.errors) / numberValue(summary?.total_events)) * 100 : 0;
  const healthLabel = errorRate === 0 ? "Estable" : errorRate <= 5 ? "Atención" : "Crítico";
  const healthTone = errorRate === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : errorRate <= 5 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-800";
  const cards: Array<[string, string, LucideIcon, string]> = [
    ["Eventos", numberValue(summary?.total_events).toLocaleString(), Activity, "Acciones registradas"],
    ["Usuarios", numberValue(summary?.active_users).toLocaleString(), Users, "Usuarios activos"],
    ["Tokens", numberValue(summary?.tokens_total).toLocaleString(), BarChart3, "Entrada + salida"],
    ["Costo API", money(summary?.estimated_cost_usd), CircleDollarSign, "Estimado real por modelo"],
    ["Errores", numberValue(summary?.errors).toLocaleString(), AlertTriangle, `${errorRate.toFixed(1)}% del periodo`],
    ["Pico/hora", numberValue(summary?.peak_users_hour).toLocaleString(), Activity, "Usuarios simultaneos"]
  ];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Módulo Métricas"
          title="Consumo y salud operativa"
          copy="Datos reales de usage_metrics: tokens, costos API, errores, usuarios activos y actividad por módulo."
          actions={
            <>
              <StatusBadge tone={errorRate === 0 ? "ok" : errorRate <= 5 ? "warn" : "danger"}><ShieldCheck className="h-3.5 w-3.5" /> Salud: {healthLabel}</StatusBadge>
              <Button type="button" onClick={() => setRefreshTick((current) => current + 1)} variant="secondary" size="md">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refrescar
              </Button>
            </>
          }
        />
      </ModuleSection>

      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}

      <section className="grid gap-3 rounded-xl border border-line bg-panel p-5 shadow-sm lg:grid-cols-3">
        <label className="grid gap-2 text-sm font-semibold text-slate-800">
          Periodo
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="app-input h-11">
            {[7, 30, 60, 90, 180].map((value) => (
              <option key={value} value={value}>
                Ultimos {value} dias
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-800">
          Usuario
          <select value={username} onChange={(event) => setUsername(event.target.value)} className="app-input h-11">
            {(options.users || ["Todos"]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-800">
          Módulo
          <select value={module} onChange={(event) => setModule(event.target.value)} className="app-input h-11">
            {(options.modules || ["Todos"]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value, Icon, copy]) => (
          <div key={String(label)} className="rounded-xl border border-line bg-panel p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Icon className="h-4 w-4 text-brand" />
              {String(label)}
            </div>
            <div className="mt-2 text-2xl font-semibold">{String(value)}</div>
            <p className="mt-1 text-xs leading-5 text-muted">{String(copy)}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className={`rounded-xl border p-5 shadow-sm ${healthTone}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" />
            Lectura ejecutiva
          </div>
          <div className="mt-3 text-2xl font-semibold">{healthLabel}</div>
          <p className="mt-2 text-sm leading-6">
            {errorRate === 0
              ? "No hay errores registrados para el filtro actual."
              : `Hay ${numberValue(summary?.errors)} errores en ${numberValue(summary?.total_events)} eventos. Conviene revisar los errores recientes antes de seguir escalando usuarios.`}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Errores recientes</div>
          <div className="mt-4 space-y-2">
            {(summary?.recent_errors || []).length ? (
              (summary?.recent_errors || []).slice(0, 6).map((row, index) => (
                <div key={index} className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm font-semibold text-rose-900">{String(row.module || "módulo")} | {String(row.action || "acción")}</div>
                    <div className="text-xs font-semibold text-rose-700">{shortDate(row.created_at)}</div>
                  </div>
                  <div className="mt-1 text-xs text-rose-800">{String(row.username || "sin usuario")} | {String(row.provider || "sin proveedor")} | {String(row.model || "sin modelo")}</div>
                  <div className="mt-2 text-sm leading-5 text-rose-900">{String(row.error_message || "Sin detalle de error.")}</div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-muted">Sin errores recientes para este filtro.</div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <TopTable title="Consumo por módulo" rows={summary?.by_module || []} columns={["module", "action", "tokens"]} />
        <TopTable title="Consumo por usuario" rows={summary?.by_user || []} columns={["username", "eventos", "tokens"]} />
        <TopTable title="Costo mensual" rows={summary?.by_month || []} columns={["month", "tokens", "costo_estimado"]} />
        <TopTable title="Estados / errores" rows={summary?.by_status || []} columns={["status", "eventos"]} />
      </section>

      {summary?.uncosted_events ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Hay {summary.uncosted_events} eventos antiguos con tokens totales pero sin entrada/salida. Se muestran sin costo para no inventar gastos.
        </section>
      ) : null}
    </div>
  );
}

