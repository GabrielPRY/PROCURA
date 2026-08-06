"use client";

import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  Search,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AuthUser } from "@/lib/auth";
import {
  deleteSeguimiento,
  getSeguimientoHistorial,
  getSeguimientos,
  saveSeguimientoSliSnapshot,
  updateSeguimientoEstado,
  type Seguimiento,
  type SeguimientoHistorial
} from "@/lib/seguimiento";
import { consultarSli, type SliLookupResult } from "@/lib/sli";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

const estadosBase = [
  "ANUNCIO",
  "ABIERTA",
  "Oferta Enviada al SLI",
  "Cumple Tecnicamente",
  "No Cumple Tecnicamente",
  "En Evaluacion Economica",
  "Adjudicada",
  "No Adjudicada",
  "Desierta"
];

type BadgeTone = "neutral" | "info" | "ok" | "warn" | "danger";

function statusTone(status?: string | null): BadgeTone {
  const normalized = normalizeStatus(status);
  if (normalized.includes("no cumple") || normalized.includes("no adjudicada") || normalized.includes("desierta")) return "danger";
  if (normalized.includes("adjudicada") || normalized.includes("cumple")) return "ok";
  if (normalized.includes("evaluacion") || normalized.includes("enviada")) return "info";
  if (normalized.includes("anuncio") || normalized.includes("abierta")) return "ok";
  if (normalized.includes("cerrada") || normalized.includes("adjudicacion")) return "warn";
  return "neutral";
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function parseSliDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const direct = new Date(raw.replace(" ", "T"));
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  const match = normalized.match(/(\d{1,2})[-/\s](ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[-/\s](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i);
  if (!match) return null;
  const months: Record<string, number> = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11 };
  let hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const meridian = String(match[6] || "").toLowerCase();
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  return new Date(Number(match[3]), months[match[2]] ?? 0, Number(match[1]), hour, minute);
}

function hoursUntil(value?: string | null) {
  const date = parseSliDate(value);
  return date ? (date.getTime() - Date.now()) / 36e5 : null;
}

function hasRevisionChange(result?: SliLookupResult | null) {
  if (!result) return false;
  if (String(result.numero_enmienda || "").trim()) return true;
  const publication = parseSliDate(result.fecha_publicacion);
  const revision = parseSliDate(result.ultima_revision);
  return Boolean(publication && revision && revision.getTime() > publication.getTime());
}

function cleanRfq(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeStatus(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function displayStatus(value?: string | null) {
  const status = String(value || "").trim();
  const labels: Record<string, string> = {
    "Cumple Tecnicamente": "Cumple técnicamente",
    "No Cumple Tecnicamente": "No cumple técnicamente",
    "En Evaluacion Economica": "En evaluación económica",
    "No Adjudicada": "No adjudicada",
    "Oferta Enviada al SLI": "Oferta enviada al SLI"
  };
  return labels[status] || status;
}

function suggestedEstadoFromSli(result?: SliLookupResult | null, current = "En Preparacion") {
  const acta = result?.resumen_acta;
  if (acta?.posible_adjudicacion_propia) return "Adjudicada";
  if (acta?.cumplimiento_tecnico === "no_cumple") return "No Cumple Tecnicamente";
  if (acta?.cumplimiento_tecnico === "cumple") return "Cumple Tecnicamente";
  const status = normalizeStatus(result?.estatus);
  if (status.includes("no adjudicada") || status.includes("no adjudicado")) return "No Adjudicada";
  if (status.includes("adjudicada") || status.includes("adjudicado")) return "Adjudicada";
  if (status.includes("adjudicacion") || status.includes("evalu") || status.includes("cerrada")) return "En Evaluacion Economica";
  if (status.includes("desierta") || status.includes("acto desierto")) return "Desierta";
  if (status.includes("anuncio")) return "ANUNCIO";
  if (status.includes("abierta")) return current.includes("Oferta Enviada") ? current : "ABIERTA";
  return "";
}

function sliOperationalAlert(item: Seguimiento, result?: SliLookupResult | null) {
  if (!result) return "";
  if (result.error) return result.error;
  const acta = result.resumen_acta;
  if (acta?.posible_adjudicacion_propia) return "El acta menciona una posible adjudicación a Proyelec/EP. Verifica el documento oficial.";
  if (acta?.cumplimiento_tecnico === "no_cumple") return "El acta contiene una posible observación de no cumplimiento técnico para Proyelec/EP.";
  const hours = hoursUntil(result.fecha_cierre);
  if (hours !== null && hours >= 0 && hours <= 72) return `Cierre cercano: quedan ${Math.max(1, Math.round(hours))} hora(s).`;
  if (hasRevisionChange(result)) return `El SLI registra ${result.numero_enmienda ? `enmienda ${result.numero_enmienda}` : "una revisión posterior"}.`;
  if (result.requiere_revision_rfq) return result.nota_revision_rfq || "Revisar RFQ/pliego: el SLI no expone suficiente detalle.";
  const suggested = suggestedEstadoFromSli(result, item.estado || "En Preparacion");
  if (suggested && suggested !== item.estado) return `El SLI actualizó el estado a ${suggested}.`;
  return "";
}

function matchesSearch(item: Seguimiento, query: string) {
  if (!query.trim()) return true;
  const haystack = [item.numero_licitacion, item.objeto, item.estado, item.responsable, item.owner_username, item.notas]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function SeguimientoConsole({ user }: { user: AuthUser }) {
  const isGlobalViewer = user.role === "Supervisor" || user.role === "Gerencia";
  const [items, setItems] = useState<Seguimiento[]>([]);
  const [selected, setSelected] = useState<Seguimiento | null>(null);
  const [history, setHistory] = useState<SeguimientoHistorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [sliResults, setSliResults] = useState<Record<number, SliLookupResult>>({});
  const [sliLoading, setSliLoading] = useState<Record<number, boolean>>({});
  const [sliErrors, setSliErrors] = useState<Record<number, string>>({});
  const [syncMeta, setSyncMeta] = useState<Record<number, { checkedAt: string; changed?: boolean }>>({});
  const [bulkSync, setBulkSync] = useState({ running: false, done: 0, total: 0 });
  const itemsRef = useRef<Seguimiento[]>([]);
  const bulkSyncRef = useRef(false);
  const initialSyncRef = useRef(false);
  const syncCursorRef = useRef(0);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await getSeguimientos({ username: user.username, role: user.role });
      const nextItems = response.seguimientos || [];
      const persistedResults: Record<number, SliLookupResult> = {};
      const persistedMeta: Record<number, { checkedAt: string; changed?: boolean }> = {};
      nextItems.forEach((item) => {
        if (item.sli_snapshot) persistedResults[item.id] = item.sli_snapshot;
        if (item.sli_checked_at) persistedMeta[item.id] = { checkedAt: item.sli_checked_at, changed: false };
      });
      setItems(nextItems);
      setSliResults((current) => ({ ...persistedResults, ...current }));
      setSyncMeta((current) => ({ ...persistedMeta, ...current }));
      setSelected((current) => current ? nextItems.find((item) => item.id === current.id) || null : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar seguimiento.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    initialSyncRef.current = false;
    setSelected(null);
    setSliResults({});
    setSyncMeta({});
    void refresh();
  }, [user.role, user.username]);

  async function loadHistory(itemId: number) {
    try {
      const response = await getSeguimientoHistorial(itemId);
      setHistory(response.historial || []);
    } catch {
      setHistory([]);
    }
  }

  async function openItem(item: Seguimiento) {
    setSelected(item);
    setComment("");
    void loadHistory(item.id);
    if (!sliResults[item.id] && !sliLoading[item.id]) void checkSli(item, true);
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      window.setTimeout(() => document.getElementById("seguimiento-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }

  async function saveComment() {
    if (!selected || !comment.trim()) return;
    setError(null);
    try {
      await updateSeguimientoEstado(selected.id, {
        estado: selected.estado || "En Preparacion",
        nota: comment.trim(),
        registrado_por: user.username
      });
      setComment("");
      await refresh();
      await loadHistory(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el comentario.");
    }
  }

  async function checkSli(item: Seguimiento, syncStatus = true) {
    const rfq = cleanRfq(item.numero_licitacion);
    if (!rfq) {
      setSliErrors((current) => ({ ...current, [item.id]: "Número de licitación inválido." }));
      return;
    }
    setSliLoading((current) => ({ ...current, [item.id]: true }));
    setSliErrors((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    try {
      const result = await consultarSli(rfq);
      const suggested = suggestedEstadoFromSli(result, item.estado || "En Preparacion");
      const persisted = await saveSeguimientoSliSnapshot(item.id, result);
      const snapshotUpdated = { ...item, sli_snapshot: result, sli_checked_at: persisted.sli_checked_at };
      setSliResults((current) => ({ ...current, [item.id]: result }));
      setSyncMeta((current) => ({
        ...current,
        [item.id]: { checkedAt: persisted.sli_checked_at, changed: Boolean(suggested && suggested !== item.estado) }
      }));
      setItems((current) => current.map((row) => row.id === item.id ? snapshotUpdated : row));
      setSelected((current) => current?.id === item.id ? snapshotUpdated : current);
      if (result.error) setSliErrors((current) => ({ ...current, [item.id]: result.error || "SLI respondió con advertencia." }));

      if (syncStatus && suggested && suggested !== item.estado) {
        const notes = [
          `Sincronizado con SLI: ${result.estatus || "estado no especificado"}.`,
          result.fecha_cierre ? `Cierre: ${result.fecha_cierre}.` : "",
          result.numero_enmienda ? `Enmienda: ${result.numero_enmienda}.` : "",
          result.resumen_acta?.resumen || ""
        ].filter(Boolean).join(" ");
        await updateSeguimientoEstado(item.id, { estado: suggested, nota: notes, registrado_por: "Sistema SLI" });
        const updated = { ...snapshotUpdated, estado: suggested };
        setItems((current) => current.map((row) => row.id === item.id ? updated : row));
        setSelected((current) => current?.id === item.id ? updated : current);
        if (selected?.id === item.id) await loadHistory(item.id);
      }
    } catch (err) {
      setSliErrors((current) => ({ ...current, [item.id]: err instanceof Error ? err.message : "No se pudo consultar el SLI." }));
    } finally {
      setSliLoading((current) => ({ ...current, [item.id]: false }));
    }
  }

  async function syncItems(candidates: Seguimiento[]) {
    if (bulkSyncRef.current || !candidates.length) return;
    bulkSyncRef.current = true;
    setBulkSync({ running: true, done: 0, total: candidates.length });
    try {
      for (const item of candidates) {
        await checkSli(item, true);
        setBulkSync((current) => ({ ...current, done: current.done + 1 }));
      }
    } finally {
      bulkSyncRef.current = false;
      setBulkSync((current) => ({ ...current, running: false }));
    }
  }

  function nextAutomaticBatch(limit = 8) {
    const validItems = itemsRef.current.filter((item) => cleanRfq(item.numero_licitacion));
    if (!validItems.length) return [];
    const start = syncCursorRef.current % validItems.length;
    const batch = Array.from({ length: Math.min(limit, validItems.length) }, (_, offset) => validItems[(start + offset) % validItems.length]);
    syncCursorRef.current = (start + batch.length) % validItems.length;
    return batch;
  }

  useEffect(() => {
    if (loading || initialSyncRef.current || !items.length) return;
    initialSyncRef.current = true;
    const timer = window.setTimeout(() => void syncItems(nextAutomaticBatch()), 600);
    return () => window.clearTimeout(timer);
  }, [items.length, loading]);

  useEffect(() => {
    const interval = window.setInterval(() => void syncItems(nextAutomaticBatch()), 25 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [user.role, user.username]);

  async function removeItem(item: Seguimiento) {
    if (!window.confirm(`¿Eliminar la licitación ${item.numero_licitacion} de tu seguimiento?`)) return;
    try {
      await deleteSeguimiento(item.id);
      setItems((current) => current.filter((row) => row.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el seguimiento.");
    }
  }

  const states = useMemo(() => {
    const dynamic = items.map((item) => String(item.estado || "").trim()).filter(Boolean);
    return Array.from(new Set([...estadosBase, ...dynamic]));
  }, [items]);
  const alertCount = items.filter((item) => Boolean(sliOperationalAlert(item, sliResults[item.id]) || sliErrors[item.id])).length;
  const filteredItems = useMemo(
    () => items
      .filter((item) => statusFilter === "Todos" || item.estado === statusFilter)
      .filter((item) => !alertsOnly || Boolean(sliOperationalAlert(item, sliResults[item.id]) || sliErrors[item.id]))
      .filter((item) => matchesSearch(item, search))
      .sort((a, b) => String(b.fecha_registro || "").localeCompare(String(a.fecha_registro || ""))),
    [alertsOnly, items, search, sliErrors, sliResults, statusFilter]
  );
  const closedStates = ["Adjudicada", "No Adjudicada", "Desierta"];
  const activeCount = items.filter((item) => !closedStates.includes(String(item.estado || ""))).length;
  const closeSoonCount = Object.values(sliResults).filter((result) => {
    const hours = hoursUntil(result.fecha_cierre);
    return hours !== null && hours >= 0 && hours <= 72;
  }).length;
  const lastSync = Object.values(syncMeta)
    .map((meta) => meta.checkedAt)
    .sort()
    .at(-1);

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Seguimiento"
          title="Procesos conectados con el SLI"
          copy="El sistema revisa estados, cierres, enmiendas y actas. Los usuarios documentan comentarios; el estado no se elige manualmente."
          actions={
            <Button
              type="button"
              onClick={() => void syncItems(items.filter((item) => cleanRfq(item.numero_licitacion)).slice(0, 20))}
              disabled={bulkSync.running || loading}
              variant="primary"
            >
              {bulkSync.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              {bulkSync.running ? `${bulkSync.done}/${bulkSync.total}` : "Sincronizar SLI"}
            </Button>
          }
        />
      </ModuleSection>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}</div> : null}

      <ModuleSection className="p-0">
        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {[
            [isGlobalViewer ? "Vista global" : "Mis procesos", items.length, isGlobalViewer ? "Equipo completo" : user.username],
            ["Activos", activeCount, "En curso"],
            ["Alertas", alertCount, "Requieren revisión"],
            ["Cierre 72 h", closeSoonCount, lastSync ? `Sync ${formatDate(lastSync)}` : "Pendiente de sync"]
          ].map(([label, value, hint]) => (
            <div key={String(label)} className="min-w-0 p-4 sm:p-5">
              <div className="text-xs font-semibold text-muted">{String(label)}</div>
              <div className="mt-2 text-xl font-semibold text-ink">{String(value)}</div>
              <div className="mt-1 truncate text-xs text-muted">{String(hint)}</div>
            </div>
          ))}
        </div>
      </ModuleSection>

      <ModuleSection>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Buscar seguimiento</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar RFQ, objeto, responsable o comentario" className="app-input h-11 w-full pl-9 pr-3" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="app-input h-11 sm:w-56">
              <option value="Todos">Todos los estados</option>
              {states.map((state) => <option key={state} value={state}>{displayStatus(state)}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setAlertsOnly((current) => !current)} variant={alertsOnly ? "primary" : "secondary"}>
              <BellRing className="h-4 w-4" /> Solo alertas
            </Button>
            <Button type="button" onClick={() => void refresh()} variant="ghost" size="icon" title="Actualizar registros">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </ModuleSection>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ModuleSection className="min-w-0 p-0">
          <div className="flex items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">Procesos</h2>
              <p className="mt-1 text-sm text-muted">{filteredItems.length} de {items.length} visibles</p>
            </div>
            <StatusBadge tone="neutral">Lecturas SLI guardadas</StatusBadge>
          </div>

          {loading && !items.length ? (
            <div className="flex min-h-56 items-center justify-center gap-2 text-sm font-semibold text-brand"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</div>
          ) : filteredItems.length ? (
            <div className="divide-y divide-line">
              {filteredItems.map((item) => {
                const result = sliResults[item.id];
                const alert = sliErrors[item.id] || sliOperationalAlert(item, result);
                const isSelected = selected?.id === item.id;
                return (
                  <article key={item.id} className={`min-w-0 p-4 transition sm:p-5 ${isSelected ? "bg-blue-50" : "bg-panel hover:bg-slate-50"}`}>
                    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <button type="button" onClick={() => void openItem(item)} aria-current={isSelected ? "true" : undefined} className="min-w-0 flex-1 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-brand">{item.numero_licitacion}</span>
                          <StatusBadge tone={statusTone(item.estado)}>{displayStatus(item.estado) || "Pendiente SLI"}</StatusBadge>
                          {result?.estatus ? <StatusBadge tone={statusTone(result.estatus)}>SLI: {displayStatus(result.estatus)}</StatusBadge> : null}
                        </div>
                        <div className="mt-2 line-clamp-2 break-words text-sm font-semibold leading-6 text-ink">{item.objeto || "Sin objeto registrado"}</div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                          <span>{item.responsable || item.owner_username || "Sin responsable"}</span>
                          {isGlobalViewer && item.owner_username ? <span>Usuario: {item.owner_username}</span> : null}
                          <span>{formatDate(item.fecha_registro)}</span>
                          {result?.fecha_cierre ? <span>Cierre: {result.fecha_cierre}</span> : null}
                        </div>
                        {alert ? (
                          <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{alert}</span>
                          </div>
                        ) : null}
                      </button>

                      <div className="flex shrink-0 gap-2">
                        <Button type="button" onClick={() => void checkSli(item, true)} disabled={sliLoading[item.id]} variant="secondary" size="icon" title="Sincronizar esta licitación">
                          {sliLoading[item.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                        </Button>
                        {(item.link_sli || result?.url) ? (
                          <a href={item.link_sli || result?.url || "#"} target="_blank" rel="noreferrer" className="app-btn app-btn-secondary inline-flex h-10 w-10 items-center justify-center" title="Abrir en SLI">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : null}
                        <Button type="button" onClick={() => void removeItem(item)} variant="danger" size="icon" title="Eliminar de mi seguimiento"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="p-5"><EmptyState icon={Search} title="No hay procesos con esos filtros" copy="Cambia la búsqueda o desactiva Solo alertas. Las licitaciones se agregan desde Radar." /></div>
          )}
        </ModuleSection>

        <ModuleSection id="seguimiento-detail" className="app-scrollbar min-w-0 scroll-mt-32 self-start xl:sticky xl:top-32 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">
          {selected ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-muted">Detalle</div>
                  <h2 className="mt-1 break-words text-lg font-semibold text-ink">{selected.numero_licitacion}</h2>
                  <p className="mt-1 break-words text-sm leading-5 text-muted">{selected.objeto || "Sin objeto registrado"}</p>
                </div>
                <StatusBadge tone={statusTone(selected.estado)}>{displayStatus(selected.estado) || "Pendiente"}</StatusBadge>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                Estado calculado automáticamente desde el SLI. Última revisión: {syncMeta[selected.id]?.checkedAt ? formatDate(syncMeta[selected.id].checkedAt) : "pendiente"}.
              </div>

              {sliResults[selected.id] || sliErrors[selected.id] ? (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">Datos del SLI</h3>
                    <Button type="button" onClick={() => void checkSli(selected, true)} disabled={sliLoading[selected.id]} variant="ghost" size="sm">
                      {sliLoading[selected.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Actualizar
                    </Button>
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    {[
                      ["Estado SLI", sliResults[selected.id]?.estatus || sliErrors[selected.id] || "N/D"],
                      ["Cierre", sliResults[selected.id]?.fecha_cierre || "N/D"],
                      ["Publicación", sliResults[selected.id]?.fecha_publicacion || "N/D"],
                      ["Última revisión", sliResults[selected.id]?.ultima_revision || "N/D"],
                      ["Enmienda", sliResults[selected.id]?.numero_enmienda || "No detectada"],
                      ["Agente ACP", sliResults[selected.id]?.agente_compras || "N/D"]
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0 border-t border-line pt-2 first:border-0 first:pt-0 sm:[&:nth-child(2)]:border-0 sm:[&:nth-child(2)]:pt-0">
                        <dt className="text-xs font-semibold text-muted">{label}</dt>
                        <dd className="mt-1 break-words text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {sliResults[selected.id]?.resumen_acta?.disponible ? (
                <div className="rounded-lg border border-line bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">Lectura del acta</h3>
                    {sliResults[selected.id]?.resumen_acta?.posible_adjudicacion_propia ? <StatusBadge tone="ok">Posible adjudicación propia</StatusBadge> : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink">{sliResults[selected.id]?.resumen_acta?.resumen}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {sliResults[selected.id]?.resumen_acta?.menciona_proyelec ? <StatusBadge tone="info">Menciona Proyelec</StatusBadge> : null}
                    {sliResults[selected.id]?.resumen_acta?.menciona_ep_international ? <StatusBadge tone="info">Menciona EP International</StatusBadge> : null}
                    {sliResults[selected.id]?.resumen_acta?.cumplimiento_tecnico && sliResults[selected.id]?.resumen_acta?.cumplimiento_tecnico !== "indeterminado" ? (
                      <StatusBadge tone={sliResults[selected.id]?.resumen_acta?.cumplimiento_tecnico === "cumple" ? "ok" : "danger"}>
                        Técnico: {sliResults[selected.id]?.resumen_acta?.cumplimiento_tecnico === "cumple" ? "Cumple" : "Posible no cumple"}
                      </StatusBadge>
                    ) : null}
                  </div>
                  {sliResults[selected.id]?.resumen_acta?.hallazgos?.length ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-brand">Ver evidencia detectada</summary>
                      <ul className="mt-2 space-y-2 text-xs leading-5 text-muted">
                        {sliResults[selected.id]?.resumen_acta?.hallazgos?.map((finding, index) => <li key={index}>• {finding}</li>)}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}

              <div>
                <label className="grid gap-2 text-sm font-semibold text-ink">
                  Comentario de seguimiento
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Ej.: proveedor confirmó entrega; pendiente validar garantía." className="min-h-24 w-full p-3 text-sm leading-6" />
                </label>
                <Button type="button" onClick={() => void saveComment()} disabled={!comment.trim()} variant="primary" className="mt-3">
                  <MessageSquareText className="h-4 w-4" /> Guardar comentario
                </Button>
              </div>

              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-ink"><CalendarClock className="h-4 w-4 text-brand" /> Historial</div>
                {history.length ? (
                  <ol className="mt-3 space-y-4 border-l border-line pl-4">
                    {history.map((row, index) => (
                      <li key={index} className="relative">
                        <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-blue-500 bg-panel" />
                        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-ink">{displayStatus(row.estado_nuevo)}</span><span className="text-xs text-muted">{formatDate(row.fecha)}</span></div>
                        <div className="mt-1 text-xs text-muted">{row.registrado_por || "Sistema"}</div>
                        {row.nota ? <p className="mt-2 text-sm leading-6 text-ink">{row.nota}</p> : null}
                      </li>
                    ))}
                  </ol>
                ) : <div className="mt-3 text-sm text-muted">Sin historial registrado.</div>}
              </div>
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="Selecciona un proceso" copy="Verás datos del SLI, acta, comentarios e historial en un solo lugar." className="min-h-72" />
          )}
        </ModuleSection>
      </div>
    </div>
  );
}
