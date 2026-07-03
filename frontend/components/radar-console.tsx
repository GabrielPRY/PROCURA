"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, Clock, ExternalLink, EyeOff, RefreshCcw, Search, ShieldCheck, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ackRadarEnmienda,
  getRadarEscaneos,
  getRadarHistorico,
  getRadarLicitaciones,
  getRadarScheduler,
  radarFlag,
  runRadarScan,
  updateRadarEstado,
  type RadarEstado,
  type RadarHistoricoResponse,
  type RadarLicitacion,
  type RadarScanLog,
  type RadarSchedulerStatus
} from "@/lib/radar";
import { SliLookupPanel } from "@/components/sli-lookup-panel";
import { createSeguimiento } from "@/lib/seguimiento";
import { type AuthUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type FilterMode = "todas" | "nuevas" | "alertas" | "seguimiento" | "cierre72" | "descartadas" | "hoy";
type SortMode = "publicacion" | "cierre" | "score";
type DateField = "publicacion" | "cierre";

const RADAR_FILTERS_KEY = "procura_radar_filters_v1";

const estadoLabel: Record<string, string> = {
  nueva: "Nueva",
  revisada: "Revisada",
  descartada: "Descartada",
  en_seguimiento: "En seguimiento"
};

function formatDate(value?: string | null, fallback?: string | null) {
  if (!value && fallback) return fallback;
  if (!value) return "Sin fecha";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback || value;

  return new Intl.DateTimeFormat("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatCompactDate(value?: string | null, fallback?: string | null) {
  if (!value && fallback) return fallback;
  if (!value) return "Sin fecha";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback || value;

  return new Intl.DateTimeFormat("es-PA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function closeLabel(row: RadarLicitacion) {
  const time = getRowTime(row, "cierre");
  if (!time) return "Sin fecha";
  const diffDays = Math.ceil((time - Date.now()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return "Vencida";
  if (diffDays === 0) return "Cierra hoy";
  if (diffDays === 1) return "Manana";
  return `${diffDays} dias`;
}

function getRowTime(row: RadarLicitacion, field: DateField) {
  const value = field === "cierre" ? row.fecha_cierre_iso : row.fecha_apertura_iso;
  if (!value) return 0;
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sortRows(rows: RadarLicitacion[], mode: SortMode) {
  return [...rows].sort((a, b) => {
    if (mode === "score") return Number(b.score_interes || 0) - Number(a.score_interes || 0);
    const field = mode === "cierre" ? "fecha_cierre_iso" : "fecha_apertura_iso";
    const aTime = a[field] ? new Date(String(a[field])).getTime() : 0;
    const bTime = b[field] ? new Date(String(b[field])).getTime() : 0;
    return mode === "cierre" ? aTime - bTime : bTime - aTime;
  });
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "N/D";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(parsed);
}

function scoreTone(score: unknown) {
  const value = numberValue(score);
  if (value >= 75) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (value >= 45) return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function recommendationTone(tone?: string) {
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "info") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function stepTone(active: boolean, done: boolean) {
  if (done) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (active) return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-line bg-slate-50 text-slate-600";
}

function isSameRow(a: RadarLicitacion | null, b: RadarLicitacion) {
  return Boolean(a && a.id === b.id);
}

function statusTone(estado?: string | null) {
  if (estado === "descartada") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (estado === "en_seguimiento") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (estado === "revisada") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function isClosingSoon(row: RadarLicitacion) {
  const time = getRowTime(row, "cierre");
  if (!time) return false;
  const now = Date.now();
  return time >= now && time <= now + 72 * 60 * 60 * 1000;
}

function rowVisualTone(row: RadarLicitacion, selected: boolean) {
  if (selected) return "bg-blue-50/70";
  if (radarFlag(row.enmienda_alerta)) return "bg-amber-50/55";
  if (isClosingSoon(row)) return "bg-rose-50/35";
  return "";
}

export function RadarConsole({ user }: { user: AuthUser }) {
  const [rows, setRows] = useState<RadarLicitacion[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("todas");
  const [sortMode, setSortMode] = useState<SortMode>("publicacion");
  const [dateField, setDateField] = useState<DateField>("publicacion");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hideDiscarded, setHideDiscarded] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFrontendRefresh, setLastFrontendRefresh] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSliRfq, setSelectedSliRfq] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<RadarLicitacion | null>(null);
  const [historicoMatch, setHistoricoMatch] = useState<RadarHistoricoResponse | null>(null);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [scheduler, setScheduler] = useState<RadarSchedulerStatus | null>(null);
  const [scanLogs, setScanLogs] = useState<RadarScanLog[]>([]);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [supervisorNote, setSupervisorNote] = useState("");

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setFilterMode("todas");
    setSortMode("publicacion");
    setDateField("publicacion");
    setHideDiscarded(true);
  }

  async function loadRadar() {
    setLoading(true);
    setError(null);
    try {
      const response = await getRadarLicitaciones({
        search,
        soloNuevas: filterMode === "nuevas",
        soloHoy: filterMode === "hoy",
        soloAlertas: filterMode === "alertas",
        limit: 800
      });
      setRows(response.items);
      setTotal(response.total);
      setSelectedRow((current) => {
        if (!current) return null;
        return response.items.find((item) => item.id === current.id) || null;
      });
      setLastFrontendRefresh(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el Radar.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRadarHealth() {
    try {
      const [schedulerResponse, logsResponse] = await Promise.all([getRadarScheduler(), getRadarEscaneos(8)]);
      setScheduler(schedulerResponse);
      setScanLogs(logsResponse.escaneos || []);
    } catch {
      setScheduler(null);
      setScanLogs([]);
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RADAR_FILTERS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          search?: string;
          filterMode?: FilterMode;
          sortMode?: SortMode;
          dateField?: DateField;
          dateFrom?: string;
          dateTo?: string;
          hideDiscarded?: boolean;
          autoRefresh?: boolean;
        };
        if (typeof parsed.search === "string") setSearch(parsed.search);
        if (parsed.filterMode) setFilterMode(parsed.filterMode);
        if (parsed.sortMode) setSortMode(parsed.sortMode);
        if (parsed.dateField) setDateField(parsed.dateField);
        if (typeof parsed.dateFrom === "string") setDateFrom(parsed.dateFrom);
        if (typeof parsed.dateTo === "string") setDateTo(parsed.dateTo);
        if (typeof parsed.hideDiscarded === "boolean") setHideDiscarded(parsed.hideDiscarded);
        if (typeof parsed.autoRefresh === "boolean") setAutoRefresh(parsed.autoRefresh);
      }
    } catch {
      window.localStorage.removeItem(RADAR_FILTERS_KEY);
    } finally {
      setFiltersHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    window.localStorage.setItem(
      RADAR_FILTERS_KEY,
      JSON.stringify({ search, filterMode, sortMode, dateField, dateFrom, dateTo, hideDiscarded, autoRefresh })
    );
  }, [autoRefresh, dateField, dateFrom, dateTo, filterMode, filtersHydrated, hideDiscarded, search, sortMode]);

  useEffect(() => {
    const timer = window.setTimeout(loadRadar, 250);
    return () => window.clearTimeout(timer);
  }, [search, filterMode]);

  useEffect(() => {
    void loadRadarHealth();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const intervalMs = Math.max(1, Number(scheduler?.interval_minutes || 25)) * 60 * 1000;
    const timer = window.setInterval(() => {
      void loadRadar();
      void loadRadarHealth();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoRefresh, scheduler?.interval_minutes, search, filterMode]);

  useEffect(() => {
    let mounted = true;
    if (!selectedRow?.id) {
      setHistoricoMatch(null);
      return;
    }
    setLoadingHistorico(true);
    getRadarHistorico(selectedRow.id)
      .then((response) => {
        if (mounted) setHistoricoMatch(response);
      })
      .catch(() => {
        if (mounted) setHistoricoMatch(null);
      })
      .finally(() => {
        if (mounted) setLoadingHistorico(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedRow?.id]);

  useEffect(() => {
    setSupervisorNote(selectedRow?.notas || "");
  }, [selectedRow?.id]);

  const filteredRows = useMemo(() => {
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : 0;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : 0;
    return rows.filter((row) => {
      if (hideDiscarded && filterMode !== "descartadas" && row.estado_radar === "descartada") return false;
      if (filterMode === "seguimiento" && row.estado_radar !== "en_seguimiento") return false;
      if (filterMode === "descartadas" && row.estado_radar !== "descartada") return false;
      if (filterMode === "cierre72") {
        const closeTime = getRowTime(row, "cierre");
        const now = Date.now();
        if (!closeTime || closeTime < now || closeTime > now + 72 * 60 * 60 * 1000) return false;
      }
      const rowTime = getRowTime(row, dateField);
      if (fromTime && (!rowTime || rowTime < fromTime)) return false;
      if (toTime && (!rowTime || rowTime > toTime)) return false;
      return true;
    });
  }, [rows, dateField, dateFrom, dateTo, filterMode, hideDiscarded]);

  const visibleRows = useMemo(() => sortRows(filteredRows, sortMode), [filteredRows, sortMode]);
  const alertCount = rows.filter((row) => radarFlag(row.enmienda_alerta)).length;
  const trackingCount = rows.filter((row) => row.estado_radar === "en_seguimiento").length;
  const newCount = rows.filter((row) => !row.estado_radar || row.estado_radar === "nueva").length;
  const discardedCount = rows.filter((row) => row.estado_radar === "descartada").length;
  const closingSoonCount = rows.filter(isClosingSoon).length;
  const lastScan = scanLogs[0];
  const amendmentPriorityRows = rows.filter((row) => radarFlag(row.enmienda_alerta) && ["descartada", "en_seguimiento", "revisada"].includes(String(row.estado_radar || "")));
  const activeFilterCount = [
    search.trim(),
    filterMode !== "todas",
    sortMode !== "publicacion",
    dateField !== "publicacion",
    dateFrom,
    dateTo,
    !hideDiscarded
  ].filter(Boolean).length;

  async function handleScan() {
    setBusy(true);
    setError(null);
    try {
      await runRadarScan();
      await loadRadar();
      await loadRadarHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo escanear el SLI.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAck(id: number) {
    setBusy(true);
    try {
      await ackRadarEnmienda(id);
      await loadRadar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo marcar la enmienda.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEstado(id: number, estado: RadarEstado, notasOverride?: string) {
    setBusy(true);
    setError(null);
    try {
      await updateRadarEstado(id, estado, "supervisor", (notasOverride ?? supervisorNote).trim());
      await loadRadar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el estado.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnviarSeguimiento(row: RadarLicitacion, notasOverride?: string) {
    setBusy(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const nota = (notasOverride ?? supervisorNote).trim() || row.notas || `Enviado desde Radar Supervisor el ${today}.`;
      await createSeguimiento({
        numero_licitacion: String(row.numero_licitacion || "").replace(/\D/g, ""),
        owner_username: user.username,
        objeto: row.objeto || "",
        fecha_asignacion: today,
        link_sli: row.link_sli || "",
        notas: nota,
        responsable: user.username
      });
      await updateRadarEstado(row.id, "en_seguimiento", user.username, nota);
      await loadRadar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar la licitacion a seguimiento.");
    } finally {
      setBusy(false);
    }
  }

  const summaryCards: Array<[string, string | number, string, LucideIcon, string]> = [
    ["Total abiertas", total, `${visibleRows.length} visibles con filtros`, ShieldCheck, "text-blue-700"],
    ["Nuevas", newCount, "Sin revisar todavia", CheckCircle2, "text-emerald-700"],
    ["Alertas enmienda", alertCount, "Requieren revision", AlertTriangle, "text-amber-700"],
    ["Cierre 72h", closingSoonCount, "Prioridad operativa", CalendarClock, "text-rose-700"]
  ];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Radar Supervisor"
          title="Licitaciones abiertas del SLI"
          copy="Vista operativa para filtrar, ordenar, detectar enmiendas y decidir que procesos pasan a seguimiento."
          actions={
            <Button onClick={handleScan} disabled={busy} variant="primary" size="lg">
              <RefreshCcw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Escanear SLI ahora
            </Button>
          }
        />
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          <StatusBadge tone="neutral">Autoescaneo: {scheduler?.enabled === false ? "apagado" : `cada ${scheduler?.interval_minutes || 25} min`}</StatusBadge>
          <StatusBadge tone="neutral">Proximo: {scheduler?.next_run_at || "N/D"}</StatusBadge>
          <StatusBadge tone={scheduler?.last_error ? "danger" : "ok"}>{scheduler?.running ? "Escaneando ahora" : scheduler?.last_error ? "Ultimo escaneo con error" : "Scheduler listo"}</StatusBadge>
          <StatusBadge tone="neutral">Ultimo escaneo: {lastScan?.fecha || scheduler?.last_finished || "N/D"}</StatusBadge>
          <StatusBadge tone="info">Vista actualizada: {formatDate(lastFrontendRefresh)}</StatusBadge>
        </div>
      </ModuleSection>

      <section className="grid gap-3 md:grid-cols-4">
        {summaryCards.map(([label, value, hint, Icon, tone]) => (
          <div key={label} className="rounded-xl border border-line bg-panel p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted">{label}</div>
              <Icon className={`h-4 w-4 ${tone}`} />
            </div>
            <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
            <div className="mt-1 text-xs text-muted">{hint}</div>
          </div>
        ))}
      </section>

      {amendmentPriorityRows.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <div className="font-semibold">Enmiendas pendientes sobre procesos ya decididos</div>
                <p className="mt-1 leading-6">
                  Hay {amendmentPriorityRows.length} licitacion(es) descartadas, revisadas o en seguimiento que recibieron enmienda nueva.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setFilterMode("alertas");
                setHideDiscarded(false);
              }}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              Ver enmiendas
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-panel shadow-sm">
        <div className="border-b border-line p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
            <label className="relative block flex-1">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">Filtro rapido tipo Excel</span>
              <Search className="pointer-events-none absolute left-3 top-[2.65rem] h-4 w-4 text-slate-400" />
              <input
                className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
                placeholder="Escribe RFQ, objeto, categoria, agente, enmienda o palabra clave..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-muted xl:w-56">
              Ordenar por
              <select
                className="h-11 rounded-lg border border-line bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
              >
                <option value="publicacion">Publicacion mas reciente</option>
                <option value="cierre">Cierre mas cercano</option>
                <option value="score">Score mas alto</option>
              </select>
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-muted xl:w-52">
              Fecha a filtrar
              <select
                className="h-11 rounded-lg border border-line bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                value={dateField}
                onChange={(event) => setDateField(event.target.value as DateField)}
              >
                <option value="publicacion">Publicacion</option>
                <option value="cierre">Cierre</option>
              </select>
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-muted xl:w-44">
              Desde
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-11 rounded-lg border border-line bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-muted xl:w-44">
              Hasta
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="h-11 rounded-lg border border-line bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-brand"
            >
              Limpiar
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              ["todas", "Todas"],
              ["nuevas", "Nuevas"],
              ["alertas", "Con enmienda"],
              ["seguimiento", "Seguimiento"],
              ["cierre72", "Cierre 72h"],
              ["descartadas", "Descartadas"],
              ["hoy", "Descubiertas hoy"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilterMode(value as FilterMode)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  filterMode === value ? "app-filter-pill-active" : "app-filter-pill-idle"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {activeFilterCount} filtro(s)
            </span>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={hideDiscarded}
                onChange={(event) => setHideDiscarded(event.target.checked)}
                className="h-4 w-4 rounded border-line"
              />
              Ocultar descartadas
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                className="h-4 w-4 rounded border-line"
              />
              Auto {scheduler?.interval_minutes || 25} min
            </label>
            <button
              onClick={() => {
                void loadRadar();
                void loadRadarHealth();
              }}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-brand disabled:opacity-60"
            >
              Actualizar
            </button>
          </div>
        </div>

        {error ? (
          <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <div className="overflow-hidden">
          <table className="app-table">
            <thead>
              <tr>
                {["Prioridad", "Licitacion", "Objeto / categoria", "Publicacion", "Cierre", "Enmienda", "Score", "Estado", "Acciones"].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted">
                    Cargando licitaciones del SLI...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted">
                    No hay licitaciones con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const hasAmendmentAlert = radarFlag(row.enmienda_alerta);
                  const closeSoon = isClosingSoon(row);
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedRow(row)}
                      className={`cursor-pointer hover:bg-slate-50/80 ${rowVisualTone(row, isSameRow(selectedRow, row))}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          {hasAmendmentAlert ? (
                            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Enmienda
                            </span>
                          ) : null}
                          {closeSoon ? (
                            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                              <Clock className="h-3.5 w-3.5" />
                              {closeLabel(row)}
                            </span>
                          ) : null}
                          {!hasAmendmentAlert && !closeSoon ? (
                            <span className="inline-flex w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                              Normal
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-brand">{row.numero_licitacion}</div>
                        <div className="mt-1 text-xs text-muted">ID interno {row.id}</div>
                      </td>
                      <td className="max-w-[360px] px-4 py-3">
                        <div className="font-medium text-slate-900">{row.objeto || "Sin objeto"}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                          <span className="text-muted">{row.categoria || "Categoria no clasificada"}</span>
                          {hasAmendmentAlert && row.estado_radar === "descartada" ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                              Reabrir revision
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{formatCompactDate(row.fecha_apertura_iso, row.fecha_apertura)}</div>
                        <div className="mt-1 text-xs text-muted">Fecha de publicacion</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{formatCompactDate(row.fecha_cierre_iso, row.fecha_cierre)}</div>
                        <div className={`mt-1 text-xs font-semibold ${closeSoon ? "text-rose-700" : "text-muted"}`}>{closeLabel(row)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{row.numero_enmienda || "-"}</div>
                        {hasAmendmentAlert ? <div className="mt-1 text-xs font-semibold text-amber-700">Nueva sin revisar</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${scoreTone(row.score_interes)}`}>
                          {Number(row.score_interes || 0).toFixed(0)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone(row.estado_radar)}`}>
                          {estadoLabel[String(row.estado_radar || "nueva")] || row.estado_radar || "Nueva"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {row.link_sli ? (
                            <a
                              href={row.link_sli}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="app-btn-mini"
                            >
                              SLI <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedRow(row);
                              setSelectedSliRfq(String(row.numero_licitacion || ""));
                            }}
                            className="app-btn-mini"
                          >
                            <Search className="h-3.5 w-3.5" />
                            RFQ
                          </button>
                          {hasAmendmentAlert ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleAck(row.id);
                              }}
                              disabled={busy}
                              className="app-btn-mini border-amber-200 text-amber-800"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Revisada
                            </button>
                          ) : null}
                          {row.estado_radar !== "en_seguimiento" ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedRow(row);
                                void handleEnviarSeguimiento(row, row.notas || "");
                              }}
                              disabled={busy}
                              className="app-btn-mini border-blue-200 text-blue-700"
                            >
                              <RefreshCcw className="h-3.5 w-3.5" />
                              Seguir
                            </button>
                          ) : null}
                          {row.estado_radar !== "revisada" ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleEstado(row.id, "revisada");
                              }}
                              disabled={busy}
                              className="app-btn-mini border-emerald-200 text-emerald-700"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              OK
                            </button>
                          ) : null}
                          {row.estado_radar !== "descartada" ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleEstado(row.id, "descartada");
                              }}
                              disabled={busy}
                              className="app-btn-mini app-btn-danger"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Descartar
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {selectedRow ? (
          <div className="border-t border-line p-4">
            <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
              <div className="rounded-xl border border-line bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand">Detalle seleccionado</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{selectedRow.numero_licitacion} | {selectedRow.objeto || "Sin objeto"}</div>
                    <p className="mt-2 text-sm text-muted">{selectedRow.categoria || "Categoria no clasificada"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(selectedRow.estado_radar)}`}>
                    {estadoLabel[String(selectedRow.estado_radar || "nueva")] || selectedRow.estado_radar || "Nueva"}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  {[
                    ["Publicacion", formatDate(selectedRow.fecha_apertura_iso, selectedRow.fecha_apertura)],
                    ["Cierre", formatDate(selectedRow.fecha_cierre_iso, selectedRow.fecha_cierre)],
                    ["Enmienda actual", selectedRow.numero_enmienda || "Sin enmienda"],
                    ["Urgencia", closeLabel(selectedRow)]
                  ].map(([label, value]) => (
                    <div key={label} className="app-data-card">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
                    </div>
                  ))}
                </div>
                {radarFlag(selectedRow.enmienda_alerta) ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="font-semibold">Revisar por enmienda nueva</div>
                    <p className="mt-1 leading-6">
                      Esta licitacion estaba {selectedRow.estado_radar === "descartada" ? "descartada" : "en seguimiento/revisada"} y recibio una enmienda.
                      Anterior: {selectedRow.enmienda_anterior || "N/D"} | Actual: {selectedRow.numero_enmienda || "N/D"}.
                    </p>
                    {selectedRow.estado_radar === "descartada" ? (
                      <p className="mt-1 font-semibold">Conviene reabrir la revision antes de mantenerla descartada.</p>
                    ) : null}
                  </div>
                ) : null}
                {selectedRow.notas ? (
                  <div className="app-data-card mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Notas</div>
                    <div className="mt-1 text-sm leading-6 text-slate-800">{selectedRow.notas}</div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-line bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Acciones recomendadas</div>
                {historicoMatch?.summary?.recomendacion_supervisor ? (
                  <div className={`mt-3 rounded-lg border p-3 ${recommendationTone(historicoMatch.summary.recomendacion_supervisor.tone)}`}>
                    <div className="text-xs font-semibold uppercase tracking-wide">
                      Sugerencia supervisor | Prioridad {historicoMatch.summary.recomendacion_supervisor.prioridad || "Media"}
                    </div>
                    <div className="mt-1 text-base font-semibold">{historicoMatch.summary.recomendacion_supervisor.decision}</div>
                    <p className="mt-1 text-sm leading-6">{historicoMatch.summary.recomendacion_supervisor.motivo}</p>
                    <div className="mt-2 rounded-md bg-white/70 px-3 py-2 text-sm font-semibold">
                      {historicoMatch.summary.recomendacion_supervisor.accion}
                    </div>
                  </div>
                ) : loadingHistorico ? (
                  <div className="app-data-card mt-3 text-sm text-muted">
                    Calculando sugerencia...
                  </div>
                ) : null}
                <label className="mt-3 block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">Comentario supervisor</span>
                  <textarea
                    value={supervisorNote}
                    onChange={(event) => setSupervisorNote(event.target.value)}
                    rows={4}
                    placeholder="Ej: Revisar RFQ por posible enmienda, comparar contra historico y confirmar proveedor local."
                    className="mt-2 w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSliRfq(String(selectedRow.numero_licitacion || ""))}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-brand bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-dark"
                  >
                    Consultar detalle SLI/RFQ
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnviarSeguimiento(selectedRow)}
                    disabled={busy || selectedRow.estado_radar === "en_seguimiento"}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  >
                    Enviar a seguimiento
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEstado(selectedRow.id, (selectedRow.estado_radar as RadarEstado) || "nueva")}
                    disabled={busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-brand disabled:opacity-50"
                  >
                    Guardar comentario
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEstado(selectedRow.id, "descartada")}
                    disabled={busy || selectedRow.estado_radar === "descartada"}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Descartar del radar operativo
                  </button>
                  {radarFlag(selectedRow.enmienda_alerta) ? (
                    <button
                      type="button"
                      onClick={() => handleAck(selectedRow.id)}
                      disabled={busy}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800 disabled:opacity-50"
                    >
                      Marcar enmienda revisada
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-line bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand">Antecedentes historicos</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">Comparacion contra licitaciones pasadas</div>
                  <p className="mt-1 text-sm text-muted">
                    Coincidencias por numero, codigo ACP detectado y palabras del objeto. Sirve como primera senal para decidir si conviene revisar.
                  </p>
                </div>
                {loadingHistorico ? (
                  <RefreshCcw className="h-4 w-4 animate-spin text-brand" />
                ) : (
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${scoreTone(historicoMatch?.summary?.mejor_match)}`}>
                    Mejor match: {numberValue(historicoMatch?.summary?.mejor_match).toFixed(0)}
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                {[
                  {
                    label: "1. Detectada en SLI",
                    value: "Lista abierta",
                    done: true,
                    active: false
                  },
                  {
                    label: "2. Detalle SLI/RFQ",
                    value: historicoMatch?.summary?.sli_consultado ? "Consultado automaticamente" : "Sin consulta automatica",
                    done: Boolean(historicoMatch?.summary?.sli_consultado),
                    active: loadingHistorico
                  },
                  {
                    label: "3. Codigos / renglones",
                    value: historicoMatch?.codigo_matches?.length
                      ? `${historicoMatch.codigo_matches.length} codigo(s)`
                      : historicoMatch?.summary?.renglones_detectados_count
                        ? `${historicoMatch.summary.renglones_detectados_count} renglon(es)`
                        : "Requiere pliego",
                    done: Boolean(historicoMatch?.codigo_matches?.length),
                    active: Boolean(historicoMatch?.summary?.requiere_revision_rfq)
                  },
                  {
                    label: "4. Decision",
                    value: historicoMatch?.summary?.recomendacion_supervisor?.decision || "Calculando",
                    done: Boolean(historicoMatch?.summary?.recomendacion_supervisor),
                    active: loadingHistorico
                  }
                ].map((step) => (
                  <div key={step.label} className={`rounded-lg border p-3 ${stepTone(step.active, step.done)}`}>
                    <div className="text-xs font-semibold uppercase tracking-wide">{step.label}</div>
                    <div className="mt-1 text-sm font-semibold">{step.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                {[
                  ["Coincidencias", String(historicoMatch?.summary?.total || 0)],
                  ["Ganadas", String(historicoMatch?.summary?.ganadas || 0)],
                  ["Renglones SLI", String(historicoMatch?.summary?.renglones_detectados_count || 0)],
                  ["Precio min.", moneyValue(historicoMatch?.summary?.precio_min)],
                  ["Promedio", moneyValue(historicoMatch?.summary?.precio_promedio)]
                ].map(([label, value]) => (
                  <div key={label} className="app-data-card">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>

              {historicoMatch?.summary?.nota ? (
                <div className={`mt-4 rounded-lg border p-3 text-sm leading-6 ${
                  historicoMatch.summary.requiere_revision_rfq
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}>
                  {historicoMatch.summary.nota}
                </div>
              ) : null}
              {historicoMatch?.summary?.sli_error ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  No se pudo leer automaticamente el detalle SLI. La comparacion queda preliminar: {historicoMatch.summary.sli_error}
                </div>
              ) : null}

              {historicoMatch?.sli_detail?.renglones_detectados?.length ? (
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand">Renglones detectados en SLI/RFQ visible</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {historicoMatch.sli_detail.renglones_detectados.slice(0, 6).map((item, index) => (
                      <div key={`${item.renglon}-${item.codigo_articulo}-${index}`} className="rounded-lg border border-blue-100 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-brand">
                          <span>{item.renglon || `Renglon ${index + 1}`}</span>
                          {item.codigo_articulo || item.codigo_acp ? <span className="rounded-full bg-blue-50 px-2 py-0.5">{item.codigo_articulo || item.codigo_acp}</span> : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-700">{item.descripcion || "Descripcion no especificada en SLI."}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {historicoMatch?.keywords?.length || historicoMatch?.codigo_matches?.length ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  {historicoMatch.codigo_matches.map((code) => (
                    <span key={code} className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700">Codigo {code}</span>
                  ))}
                  {historicoMatch.keywords.map((keyword) => (
                    <span key={keyword} className="rounded-full border border-line bg-slate-50 px-2.5 py-1 text-slate-700">{keyword}</span>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 overflow-hidden rounded-lg border border-line">
                <table className="app-table">
                  <thead>
                    <tr>
                      {["Match", "Licitacion", "Anio", "Codigo ACP", "Cantidad", "Precio Proyelec", "Competencia", "Resultado", "Motivo"].map((heading) => (
                        <th key={heading} className="border-b border-line px-3 py-3">{heading}</th>
                      ))}
                    </tr>
                  </thead>
            <tbody>
                    {historicoMatch?.matches?.length ? (
                      historicoMatch.matches.map((match, index) => (
                        <tr key={`${match.numero_licitacion}-${match.codigo_acp}-${index}`} className="hover:bg-slate-50">
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${scoreTone(match.match_score)}`}>
                              {numberValue(match.match_score).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-semibold text-brand">{match.numero_licitacion || "N/D"}</td>
                          <td className="px-3 py-3">{match.anio || "N/D"}</td>
                          <td className="px-3 py-3">{match.codigo_acp || "N/D"}</td>
                          <td className="px-3 py-3">{match.cantidad || "N/D"}</td>
                          <td className="px-3 py-3">{moneyValue(match.precio_proyelec)}</td>
                          <td className="px-3 py-3">{moneyValue(match.precio_competencia)}</td>
                          <td className="px-3 py-3">{match.adjudicada_a_proyelec || "N/D"}</td>
                          <td className="max-w-[280px] px-3 py-3">
                            <div className="font-medium text-slate-800">{match.match_reason || "Coincidencia"}</div>
                            {match.observaciones ? <div className="mt-1 truncate text-xs text-muted">{match.observaciones}</div> : null}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-muted">
                          {loadingHistorico ? "Buscando antecedentes..." : "No se encontraron antecedentes historicos claros."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {selectedSliRfq ? (
          <div className="border-t border-line p-4">
            <SliLookupPanel initialRfq={selectedSliRfq} />
          </div>
        ) : null}
      </section>

      <details className="rounded-xl border border-line bg-panel shadow-sm">
        <summary className="flex cursor-pointer list-none flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Historial de escaneos</div>
            <p className="mt-1 text-sm text-muted">Cobertura del scraper, paginas recorridas, total detectado y errores.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {scanLogs.length} registros
            </span>
            <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              Abrir detalle
            </span>
          </div>
        </summary>
        <div className="mx-5 mb-5 overflow-hidden rounded-lg border border-line">
          <table className="app-table">
            <thead>
              <tr>
                {["Fecha", "Encontradas", "Nuevas", "Paginas", "Detectadas portal", "Metodo", "Completo", "Errores"].map((heading) => (
                  <th key={heading} className="border-b border-line px-3 py-3">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scanLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-3 py-3 font-semibold">{log.fecha || "N/D"}</td>
                  <td className="px-3 py-3">{numberValue(log.total_encontradas)}</td>
                  <td className="px-3 py-3">{numberValue(log.nuevas)}</td>
                  <td className="px-3 py-3">{numberValue(log.paginas_recorridas)}</td>
                  <td className="px-3 py-3">{numberValue(log.total_detectadas_portal)}</td>
                  <td className="px-3 py-3">{log.metodo || "N/D"}</td>
                  <td className="px-3 py-3">{radarFlag(log.escaneo_completo) ? "Si" : "No"}</td>
                  <td className="max-w-[280px] px-3 py-3 text-rose-700">{log.errores || "-"}</td>
                </tr>
              ))}
              {!scanLogs.length ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">Sin historial de escaneos disponible.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}




