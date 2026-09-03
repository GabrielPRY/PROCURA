"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Clock, ExternalLink, RefreshCcw, Search, ShieldCheck, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ackRadarEnmienda,
  analyzeRadarRfq,
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
import { createSeguimiento } from "@/lib/seguimiento";
import { type AuthUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type FilterMode = "todas" | "nuevas" | "alertas" | "seguimiento" | "cierre72" | "descartadas" | "hoy";
type SortMode = "publicacion" | "cierre";
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
  if (diffDays === 1) return "Mañana";
  return `${diffDays} días`;
}

function getRowTime(row: RadarLicitacion, field: DateField) {
  const value = field === "cierre" ? row.fecha_cierre_iso : row.fecha_apertura_iso;
  if (!value) return 0;
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sortRows(rows: RadarLicitacion[], mode: SortMode) {
  return [...rows].sort((a, b) => {
    const field = mode === "cierre" ? "fecha_cierre_iso" : "fecha_apertura_iso";
    const missingTime = mode === "cierre" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const parsedA = a[field] ? new Date(String(a[field])).getTime() : missingTime;
    const parsedB = b[field] ? new Date(String(b[field])).getTime() : missingTime;
    const aTime = Number.isNaN(parsedA) ? missingTime : parsedA;
    const bTime = Number.isNaN(parsedB) ? missingTime : parsedB;
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

export function RadarConsole({ user, active = true }: { user: AuthUser; active?: boolean }) {
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<RadarLicitacion | null>(null);
  const [historicoMatch, setHistoricoMatch] = useState<RadarHistoricoResponse | null>(null);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [historicoError, setHistoricoError] = useState<string | null>(null);
  const [scheduler, setScheduler] = useState<RadarSchedulerStatus | null>(null);
  const [scanLogs, setScanLogs] = useState<RadarScanLog[]>([]);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [supervisorNote, setSupervisorNote] = useState("");
  const detailPanelRef = useRef<HTMLDivElement>(null);

  function selectRadarRow(row: RadarLicitacion) {
    setSelectedRow(row);
    if (typeof window !== "undefined" && window.innerWidth < 1536) {
      window.setTimeout(() => detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }

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
        limit: 2000
      });
      setRows(response.items);
      setTotal(response.total);
      setSelectedRow((current) => {
        if (!current) return null;
        return response.items.find((item) => item.id === current.id) || null;
      });
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

  async function handleAnalyzeRfq(force = false) {
    if (!selectedRow?.id) return;
    setLoadingHistorico(true);
    setHistoricoError(null);
    try {
      const response = await analyzeRadarRfq(selectedRow.id, 12, force);
      setHistoricoMatch(response);
    } catch (err) {
      setHistoricoError(err instanceof Error ? err.message : "No se pudo analizar el RFQ seleccionado.");
    } finally {
      setLoadingHistorico(false);
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
        if (parsed.sortMode === "publicacion" || parsed.sortMode === "cierre") setSortMode(parsed.sortMode);
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
    if (!active) return;
    const timer = window.setTimeout(loadRadar, 250);
    return () => window.clearTimeout(timer);
  }, [active, search, filterMode]);

  useEffect(() => {
    if (!active) return;
    void loadRadarHealth();
  }, [active]);

  useEffect(() => {
    if (!active || !autoRefresh) return;
    const intervalMs = Math.max(1, Number(scheduler?.interval_minutes || 25)) * 60 * 1000;
    const timer = window.setInterval(() => {
      void loadRadar();
      void loadRadarHealth();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, autoRefresh, scheduler?.interval_minutes, search, filterMode]);

  useEffect(() => {
    if (!active || (!scheduler?.running && !scheduler?.stale)) return;
    const timer = window.setInterval(async () => {
      await loadRadarHealth();
      await loadRadar();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, scheduler?.running, scheduler?.stale, search, filterMode]);

  useEffect(() => {
    let mounted = true;
    if (!active || !selectedRow?.id) {
      setHistoricoMatch(null);
      setHistoricoError(null);
      return;
    }
    setLoadingHistorico(true);
    setHistoricoError(null);
    getRadarHistorico(selectedRow.id, 12, false)
      .then((response) => {
        if (mounted) setHistoricoMatch(response);
      })
      .catch((err) => {
        if (mounted) setHistoricoMatch(null);
        if (mounted) setHistoricoError(err instanceof Error ? err.message : "No se pudo consultar el análisis guardado.");
      })
      .finally(() => {
        if (mounted) setLoadingHistorico(false);
      });
    return () => {
      mounted = false;
    };
  }, [active, selectedRow?.id]);

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
  const deepAnalysisAvailable = Boolean(historicoMatch?.cache_meta?.available);
  const deepAnalysisStale = Boolean(historicoMatch?.cache_meta?.stale);
  const deepAnalysisFailed = deepAnalysisAvailable && historicoMatch?.cache_meta?.status === "error";
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
      await updateRadarEstado(id, estado, user.username, (notasOverride ?? supervisorNote).trim());
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
      setError(err instanceof Error ? err.message : "No se pudo enviar la licitación a seguimiento.");
    } finally {
      setBusy(false);
    }
  }

  const summaryCards: Array<[string, string | number, string, LucideIcon, string]> = [
    ["Total abiertas", total, `${visibleRows.length} visibles con filtros`, ShieldCheck, "text-blue-700"],
    ["Nuevas", newCount, "Sin revisar todavía", CheckCircle2, "text-emerald-700"],
    ["Alertas enmienda", alertCount, "Requieren revisión", AlertTriangle, "text-amber-700"],
    ["Cierre 72h", closingSoonCount, "Prioridad operativa", CalendarClock, "text-rose-700"]
  ];
  const monitorStatus = scheduler?.running
    ? "Escaneando ahora"
    : scheduler?.last_error
      ? "Requiere atención"
      : lastScan && !radarFlag(lastScan.escaneo_completo)
        ? "Escaneo parcial"
        : scheduler?.stale
          ? "Actualización pendiente"
          : "Al día";
  const monitorTone = scheduler?.last_error
    ? "danger" as const
    : scheduler?.stale || (lastScan && !radarFlag(lastScan.escaneo_completo))
      ? "warn" as const
      : "ok" as const;
  const scanCoverage = lastScan
    ? `${numberValue(lastScan.paginas_recorridas)} pág. / ${numberValue(lastScan.total_detectadas_portal)} lic.`
    : "Sin datos de cobertura";

  return (
    <div className="radar-console space-y-5">
      <div className="space-y-4">
        <PageHeader
          eyebrow="Radar Supervisor"
          title="Licitaciones abiertas del SLI"
          copy="Vista operativa para filtrar, ordenar, detectar enmiendas y decidir qué procesos pasan a seguimiento."
          actions={
            <Button onClick={handleScan} disabled={busy} variant="primary" size="lg">
              <RefreshCcw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Escanear SLI ahora
            </Button>
          }
        />
        <ModuleSection className="p-0">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <span className="text-sm font-semibold text-ink">Monitor SLI</span>
              <StatusBadge tone={monitorTone}>{monitorStatus}</StatusBadge>
              <span className="text-xs text-muted">{scheduler?.enabled === false ? "Actualización manual" : `Cada ${scheduler?.interval_minutes || 25} min`}</span>
            </div>
            <dl className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
              <div className="flex min-w-0 gap-1.5"><dt className="font-semibold text-muted">Último:</dt><dd className="truncate text-ink">{lastScan?.fecha || scheduler?.last_finished || "Pendiente"}</dd></div>
              <div className="flex min-w-0 gap-1.5"><dt className="font-semibold text-muted">Cobertura:</dt><dd className="truncate text-ink">{scanCoverage}</dd></div>
            </dl>
          </div>
        </ModuleSection>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(([label, value, hint, Icon, tone]) => (
          <div key={label} className="app-stat-card p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted">{label}</div>
              <Icon className={`h-4 w-4 ${tone}`} />
            </div>
            <div className="mt-3 text-2xl font-semibold">{value}</div>
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
                  Hay {amendmentPriorityRows.length} licitación(es) descartadas, revisadas o en seguimiento que recibieron una enmienda nueva.
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

      <section className="app-surface">
        <div className="border-b border-line p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-end">
            <label className="relative block flex-1">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">Buscar en el Radar</span>
              <Search className="pointer-events-none absolute left-3 top-[2.65rem] h-4 w-4 text-slate-400" />
              <input
                className="app-input h-11 w-full pl-9 pr-3"
                placeholder="RFQ, objeto, categoría, agente o enmienda"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Ordenar por
              <select
                className="app-input h-11 text-sm font-medium normal-case tracking-normal"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
              >
                <option value="publicacion">Publicación más reciente</option>
                <option value="cierre">Cierre más cercano</option>
              </select>
            </label>
          </div>
          <details className="mt-3 rounded-lg border border-line bg-slate-50">
            <summary className="flex min-h-10 list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-ink">
              <span>Filtros avanzados</span>
              <StatusBadge tone={activeFilterCount ? "info" : "neutral"}>{activeFilterCount} activos</StatusBadge>
            </summary>
            <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2 xl:grid-cols-[180px_170px_170px_minmax(0,1fr)_auto] xl:items-end">
              <label className="grid gap-2 text-xs font-semibold uppercase text-muted">Fecha a filtrar<select className="app-input text-sm font-medium normal-case" value={dateField} onChange={(event) => setDateField(event.target.value as DateField)}><option value="publicacion">Publicación</option><option value="cierre">Cierre</option></select></label>
              <label className="grid gap-2 text-xs font-semibold uppercase text-muted">Desde<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="app-input text-sm font-medium normal-case" /></label>
              <label className="grid gap-2 text-xs font-semibold uppercase text-muted">Hasta<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="app-input text-sm font-medium normal-case" /></label>
              <div className="flex min-h-11 flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" checked={hideDiscarded} onChange={(event) => setHideDiscarded(event.target.checked)} className="h-4 w-4 rounded border-line" />Ocultar descartadas</label>
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} className="h-4 w-4 rounded border-line" />Auto {scheduler?.interval_minutes || 25} min</label>
              </div>
              <Button type="button" onClick={clearFilters} variant="secondary" size="md">Limpiar filtros</Button>
            </div>
          </details>
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
                className={`app-filter-pill px-3 py-1.5 text-xs font-semibold ${
                  filterMode === value ? "app-filter-pill-active" : "app-filter-pill-idle"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone="neutral">{visibleRows.length} visibles</StatusBadge>
            <Button
              onClick={() => {
                void loadRadar();
                void loadRadarHealth();
              }}
              disabled={loading}
              variant="secondary"
              size="md"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar
            </Button>
          </div>
        </div>

        {error ? (
          <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <div className="grid min-h-[34rem] 2xl:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]">
          <div className="min-w-0 2xl:max-h-[calc(100vh-14rem)] 2xl:overflow-y-auto 2xl:border-r 2xl:border-line">
        <div className="grid gap-2 p-3">
          {loading ? <div className="app-empty min-h-32">Cargando licitaciones del SLI...</div> : null}
          {!loading && !visibleRows.length ? <div className="app-empty min-h-32">No hay licitaciones con los filtros seleccionados.</div> : null}
          {!loading ? visibleRows.map((row) => {
            const selected = isSameRow(selectedRow, row);
            const hasAmendmentAlert = radarFlag(row.enmienda_alerta);
            const closeSoon = isClosingSoon(row);
            return (
              <button key={row.id} type="button" onClick={() => selectRadarRow(row)} className={`app-row-button w-full overflow-hidden p-3.5 text-left ${selected ? "app-row-selected" : ""}`}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-brand">RFQ {row.numero_licitacion}</div>
                    <div className="mt-1 line-clamp-2 break-words text-sm font-semibold leading-5 text-ink">{row.objeto || "Sin objeto"}</div>
                    <div className="mt-1 line-clamp-1 break-words text-xs text-muted">{row.categoria || "Categoría no clasificada"}</div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-brand" />
                </div>
                <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
                  {hasAmendmentAlert ? <StatusBadge tone="warn"><AlertTriangle className="h-3.5 w-3.5" />Enmienda</StatusBadge> : null}
                  {closeSoon ? <StatusBadge tone="danger"><Clock className="h-3.5 w-3.5" />{closeLabel(row)}</StatusBadge> : null}
                  <StatusBadge tone={row.estado_radar === "en_seguimiento" ? "info" : row.estado_radar === "descartada" ? "danger" : "neutral"}>{estadoLabel[String(row.estado_radar || "nueva")] || "Nueva"}</StatusBadge>
                </div>
                <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 2xl:grid-cols-1">
                  <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Publicación</div><div className="mt-0.5 break-words text-xs font-semibold text-ink">{formatCompactDate(row.fecha_apertura_iso, row.fecha_apertura)}</div></div>
                  <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Cierre</div><div className="mt-0.5 break-words text-xs font-semibold text-ink">{formatCompactDate(row.fecha_cierre_iso, row.fecha_cierre)}</div></div>
                </div>
              </button>
            );
          }) : null}
        </div>

          </div>
          <div ref={detailPanelRef} className={`${selectedRow ? "order-first" : "order-last"} min-w-0 scroll-mt-32 bg-slate-50/40 2xl:order-none 2xl:sticky 2xl:top-32 2xl:max-h-[calc(100vh-9rem)] 2xl:self-start 2xl:overflow-y-auto`}>

        {selectedRow ? <div className="border-b border-line p-3 2xl:hidden"><Button type="button" onClick={() => setSelectedRow(null)} variant="secondary" size="md">Volver al listado</Button></div> : null}

        {selectedRow ? (
          <div className="p-4">
            <div className="grid gap-4">
              <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand">Detalle seleccionado</div>
                    <div className="mt-1 break-words text-lg font-semibold leading-7 text-slate-900">{selectedRow.numero_licitacion} | {selectedRow.objeto || "Sin objeto"}</div>
                    <p className="mt-2 break-words text-sm leading-6 text-muted">{selectedRow.categoria || "Categoría no clasificada"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(selectedRow.estado_radar)}`}>
                    {estadoLabel[String(selectedRow.estado_radar || "nueva")] || selectedRow.estado_radar || "Nueva"}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Publicación", formatDate(selectedRow.fecha_apertura_iso, selectedRow.fecha_apertura)],
                    ["Cierre", formatDate(selectedRow.fecha_cierre_iso, selectedRow.fecha_cierre)],
                    ["Enmienda actual", selectedRow.numero_enmienda || "Sin enmienda"],
                    ["Última revisión", formatDate(undefined, selectedRow.ultima_revision)],
                    ["Urgencia", closeLabel(selectedRow)]
                  ].map(([label, value]) => (
                    <div key={label} className="app-data-card overflow-hidden">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                      <div className="mt-1 break-words text-sm font-semibold leading-5 text-slate-900">{value}</div>
                    </div>
                  ))}
                </div>
                <div className={`mt-4 rounded-xl border p-4 ${
                  deepAnalysisStale || deepAnalysisFailed
                    ? "border-amber-200 bg-amber-50/70"
                    : deepAnalysisAvailable && historicoMatch?.summary?.total
                      ? "border-emerald-200 bg-emerald-50/70"
                      : "border-blue-100 bg-blue-50/60"
                }`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-wide text-brand">Cruce histórico ACP</div>
                      <div className="mt-1 text-base font-semibold text-slate-900">
                        {loadingHistorico
                          ? "Leyendo RFQ y comparando..."
                          : deepAnalysisStale
                            ? "Hay una enmienda pendiente de analizar"
                            : deepAnalysisFailed
                              ? "No se pudo completar la lectura del RFQ"
                            : deepAnalysisAvailable && historicoMatch?.summary?.total
                              ? `${historicoMatch.summary.total} antecedente(s) encontrado(s)`
                              : deepAnalysisAvailable
                                ? "Análisis terminado sin antecedentes claros"
                                : "RFQ todavía no analizado"}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-700">
                        {deepAnalysisStale
                          ? `Se analizó la enmienda ${historicoMatch?.cache_meta?.numero_enmienda_analizada || "anterior"}. Revisa ahora la versión ${historicoMatch?.cache_meta?.numero_enmienda_actual || "actual"}.`
                          : deepAnalysisFailed
                            ? historicoMatch?.summary?.sli_error || "El portal o los documentos no respondieron correctamente. Puedes reintentar sin afectar el Radar."
                          : deepAnalysisAvailable
                            ? historicoMatch?.summary?.nota
                            : "Pulsa el botón para abrir únicamente esta licitación, leer sus documentos y comparar sus códigos ACP con el histórico."}
                      </p>
                    </div>
                    <StatusBadge tone={deepAnalysisStale || deepAnalysisFailed ? "warn" : deepAnalysisAvailable ? (historicoMatch?.summary?.total ? "ok" : "neutral") : "info"}>
                      {deepAnalysisStale ? "Enmienda nueva" : deepAnalysisFailed ? "Reintentar" : deepAnalysisAvailable ? (historicoMatch?.summary?.total ? "Con historial" : "Analizado") : "Bajo demanda"}
                    </StatusBadge>
                  </div>
                  {deepAnalysisAvailable ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ["Códigos", String(historicoMatch?.codigo_matches?.length || 0)],
                        ["Renglones", String(historicoMatch?.summary?.renglones_detectados_count || 0)],
                        ["PDF leídos", String(historicoMatch?.summary?.pdfs_consultados_count || 0)],
                        ["Ganadas", String(historicoMatch?.summary?.ganadas || 0)],
                        ["Precio mín.", moneyValue(historicoMatch?.summary?.precio_min)]
                      ].map(([label, value]) => (
                        <div key={label} className="min-w-0 overflow-hidden rounded-lg border border-white/80 bg-white/80 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
                          <div className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {historicoMatch?.codigo_matches?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {historicoMatch.codigo_matches.slice(0, 6).map((code) => (
                        <span key={code} className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700">{code}</span>
                      ))}
                    </div>
                  ) : null}
                  {historicoError ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{historicoError}</div> : null}
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button type="button" onClick={() => handleAnalyzeRfq(deepAnalysisAvailable)} disabled={loadingHistorico} variant="primary" size="md">
                      {loadingHistorico ? <RefreshCcw className="h-4 w-4 animate-spin" /> : deepAnalysisAvailable ? <RefreshCcw className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                      {loadingHistorico ? "Analizando documentos..." : deepAnalysisStale ? "Analizar enmienda" : deepAnalysisFailed ? "Reintentar análisis" : deepAnalysisAvailable ? "Actualizar análisis" : "Analizar RFQ e histórico"}
                    </Button>
                    {deepAnalysisAvailable && historicoMatch?.cache_meta?.analyzed_at ? <span className="text-xs text-muted">Último análisis: {formatDate(historicoMatch.cache_meta.analyzed_at)}</span> : null}
                  </div>
                </div>
                {radarFlag(selectedRow.enmienda_alerta) ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="font-semibold">Revisar por enmienda nueva</div>
                    <p className="mt-1 leading-6">
                      Esta licitación estaba {selectedRow.estado_radar === "descartada" ? "descartada" : "en seguimiento/revisada"} y recibió una enmienda o revisión nueva.
                      Enmienda: {selectedRow.enmienda_anterior || "N/D"} → {selectedRow.numero_enmienda || "N/D"}.
                      {selectedRow.revision_anterior || selectedRow.ultima_revision ? ` Revisión: ${selectedRow.revision_anterior || "N/D"} → ${selectedRow.ultima_revision || "N/D"}.` : ""}
                    </p>
                    {selectedRow.estado_radar === "descartada" ? (
                      <p className="mt-1 font-semibold">Conviene reabrir la revisión antes de mantenerla descartada.</p>
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

              <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Acciones recomendadas</div>
                {historicoMatch?.summary?.recomendacion_supervisor ? (
                  <div className={`mt-3 rounded-lg border p-3 ${recommendationTone(historicoMatch.summary.recomendacion_supervisor.tone)}`}>
                    <div className="text-xs font-semibold uppercase tracking-wide">
                      Sugerencia supervisor | Prioridad {historicoMatch.summary.recomendacion_supervisor.prioridad || "Media"}
                    </div>
                    <div className="mt-1 text-base font-semibold">{historicoMatch.summary.recomendacion_supervisor.decision}</div>
                    <p className="mt-1 break-words text-sm leading-6">{historicoMatch.summary.recomendacion_supervisor.motivo}</p>
                    <div className="mt-2 break-words rounded-md bg-white/70 px-3 py-2 text-sm font-semibold leading-6">
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
                    placeholder="Ej.: revisar RFQ por posible enmienda, comparar contra histórico y confirmar proveedor local."
                    className="mt-2 w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <div className="mt-3 grid gap-2">
                  <Button type="button" onClick={() => handleEnviarSeguimiento(selectedRow)} disabled={busy || selectedRow.estado_radar === "en_seguimiento"} variant="primary" size="md" className="w-full">{selectedRow.estado_radar === "en_seguimiento" ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />}{selectedRow.estado_radar === "en_seguimiento" ? "Ya está en seguimiento" : "Poner en seguimiento"}</Button>
                  {selectedRow.link_sli ? <a href={selectedRow.link_sli} target="_blank" rel="noreferrer" className="app-btn app-btn-secondary inline-flex h-10 w-full items-center justify-center gap-2 px-3 text-sm font-semibold">Abrir portal SLI<ExternalLink className="h-4 w-4" /></a> : null}
                  <Button type="button" onClick={() => handleEstado(selectedRow.id, (selectedRow.estado_radar as RadarEstado) || "nueva")} disabled={busy} variant="ghost" size="md" className="w-full">Guardar comentario</Button>
                  <Button type="button" onClick={() => handleEstado(selectedRow.id, "descartada")} disabled={busy || selectedRow.estado_radar === "descartada"} variant="danger" size="md" className="w-full">Descartar del radar operativo</Button>
                  {radarFlag(selectedRow.enmienda_alerta) ? (
                    <Button
                      type="button"
                      onClick={() => handleAck(selectedRow.id)}
                      disabled={busy}
                      variant="secondary"
                      size="md"
                      className="w-full border-amber-200 text-amber-800"
                    >
                      Marcar enmienda revisada
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {deepAnalysisAvailable ? <details className="mt-4 rounded-xl border border-line bg-white">
              <summary className="flex list-none flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand">Antecedentes históricos</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">Comparación contra licitaciones pasadas</div>
                  <p className="mt-1 text-sm text-muted">
                    Abre esta sección para consultar códigos ACP, precios y resultados anteriores.
                  </p>
                </div>
                {loadingHistorico ? (
                  <RefreshCcw className="h-4 w-4 animate-spin text-brand" />
                ) : (
                  <StatusBadge tone={historicoMatch?.summary?.total ? "ok" : "neutral"}>{historicoMatch?.summary?.total || 0} antecedente(s)</StatusBadge>
                )}
              </summary>

              <div className="border-t border-line p-4">

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    label: "1. Detectada en SLI",
                    value: "Lista abierta",
                    done: true,
                    active: false
                  },
                  {
                    label: "2. Detalle SLI/RFQ",
                    value: historicoMatch?.summary?.sli_consultado ? "Consultado bajo demanda" : "Consulta incompleta",
                    done: Boolean(historicoMatch?.summary?.sli_consultado),
                    active: loadingHistorico
                  },
                  {
                    label: "3. Códigos / renglones",
                    value: historicoMatch?.codigo_matches?.length
                      ? `${historicoMatch.codigo_matches.length} código(s)`
                      : historicoMatch?.summary?.renglones_detectados_count
                        ? `${historicoMatch.summary.renglones_detectados_count} renglón(es)`
                        : "Requiere pliego",
                    done: Boolean(historicoMatch?.codigo_matches?.length),
                    active: Boolean(historicoMatch?.summary?.requiere_revision_rfq)
                  },
                  {
                    label: "4. Decisión",
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

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Coincidencias", String(historicoMatch?.summary?.total || 0)],
                  ["Ganadas", String(historicoMatch?.summary?.ganadas || 0)],
                  ["Renglones SLI", String(historicoMatch?.summary?.renglones_detectados_count || 0)],
                  ["Precio min.", moneyValue(historicoMatch?.summary?.precio_min)],
                  ["Promedio", moneyValue(historicoMatch?.summary?.precio_promedio)]
                ].map(([label, value]) => (
                  <div key={label} className="app-data-card overflow-hidden">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                    <div className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</div>
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
                  No se pudo completar la lectura del SLI. La comparación queda preliminar: {historicoMatch.summary.sli_error}
                </div>
              ) : null}
              {historicoMatch?.sli_detail?.requiere_ocr ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Uno o más documentos parecen escaneados y no contienen texto seleccionable. Revisa esos PDF manualmente antes de tomar una decisión.
                </div>
              ) : null}

              {historicoMatch?.sli_detail?.renglones_detectados?.length ? (
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand">Renglones detectados en los documentos</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {historicoMatch.sli_detail.renglones_detectados.slice(0, 6).map((item, index) => (
                      <div key={`${item.renglon}-${item.codigo_articulo}-${index}`} className="rounded-lg border border-blue-100 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-brand">
                          <span>{item.renglon || `Renglón ${index + 1}`}</span>
                          {item.codigo_articulo || item.codigo_acp
                            ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">ACP {item.codigo_articulo || item.codigo_acp}</span>
                            : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">S/C</span>}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-700">{item.descripcion || "Descripción no especificada en el documento."}</p>
                        <div className="mt-2 text-xs text-muted">
                          {item.documento || "Detalle SLI"}{item.pagina ? ` | Página ${item.pagina}` : ""}
                        </div>
                        {item.evidencia ? <div className="mt-2 line-clamp-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs leading-5 text-slate-600">{item.evidencia}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {historicoMatch?.codigo_matches?.length ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  {historicoMatch.codigo_matches.map((code) => (
                    <span key={code} className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700">Código {code}</span>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 grid gap-3">
                {historicoMatch?.matches?.length ? (
                  historicoMatch.matches.map((match, index) => (
                    <article key={`${match.numero_licitacion}-${match.codigo_acp}-${index}`} className="min-w-0 overflow-hidden rounded-lg border border-line bg-white p-3.5">
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Licitación anterior</div>
                          <div className="mt-1 break-words text-sm font-bold text-brand">RFQ {match.numero_licitacion || "N/D"}</div>
                        </div>
                        <StatusBadge tone="info" className="self-start whitespace-normal break-words">ACP {match.codigo_acp || "N/D"}</StatusBadge>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                          ["Año", match.anio || "N/D"],
                          ["Cantidad", match.cantidad || "N/D"],
                          ["Precio Proyelec", moneyValue(match.precio_proyelec)],
                          ["Competencia", moneyValue(match.precio_competencia)]
                        ].map(([label, value]) => (
                          <div key={label} className="min-w-0 rounded-md bg-slate-50 px-2.5 py-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
                            <div className="mt-0.5 break-words text-xs font-semibold text-ink">{value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 border-t border-line pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-muted">Resultado</span>
                          <StatusBadge tone={String(match.adjudicada_a_proyelec || "").toLowerCase().includes("si") ? "ok" : "neutral"}>{match.adjudicada_a_proyelec || "N/D"}</StatusBadge>
                        </div>
                        <div className="mt-2 break-words text-sm font-medium leading-6 text-slate-800">{match.match_reason || "Coincidencia por código ACP"}</div>
                        {match.observaciones ? <div className="mt-1 break-words text-xs leading-5 text-muted">{match.observaciones}</div> : null}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="app-empty grid min-h-24 place-items-center px-4 text-center text-sm">
                    {loadingHistorico ? "Buscando antecedentes..." : "No se encontraron antecedentes históricos claros."}
                  </div>
                )}
              </div>
              </div>
            </details> : null}
          </div>
        ) : null}

        {!selectedRow ? (
          <div className="grid min-h-[28rem] place-items-center p-6 text-center">
            <div className="max-w-sm"><Search className="mx-auto h-7 w-7 text-brand" /><div className="mt-3 text-base font-semibold text-ink">Selecciona una licitación</div><p className="mt-2 text-sm leading-6 text-muted">El resumen, la comparación histórica y la acción para ponerla en seguimiento aparecerán aquí.</p></div>
          </div>
        ) : null}

          </div>
        </div>
      </section>

      <details className="rounded-xl border border-line bg-panel shadow-sm">
        <summary className="flex cursor-pointer list-none flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Historial de escaneos</div>
            <p className="mt-1 text-sm text-muted">Cobertura del scraper, páginas recorridas, total detectado y errores.</p>
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
        <div className="app-table-shell mx-5 mb-5 overflow-x-auto">
          <table className="app-table min-w-[880px]">
            <thead>
              <tr>
                {["Fecha", "Encontradas", "Nuevas", "Páginas", "Detectadas portal", "Método", "Completo", "Errores"].map((heading) => (
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





