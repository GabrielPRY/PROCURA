"use client";

import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, ExternalLink, Loader2, Plus, RefreshCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AuthUser } from "@/lib/auth";
import {
  createSeguimiento,
  deleteSeguimiento,
  getSeguimientoHistorial,
  getSeguimientos,
  updateSeguimientoEstado,
  type Seguimiento,
  type SeguimientoHistorial
} from "@/lib/seguimiento";
import { consultarSli, type SliLookupResult } from "@/lib/sli";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

const estadosBase = [
  "ANUNCIO",
  "ABIERTA",
  "CERRADA",
  "En Preparacion",
  "Oferta Enviada al SLI",
  "Cumple Tecnicamente",
  "No Cumple Tecnicamente",
  "En Evaluacion Economica",
  "Adjudicada",
  "No Adjudicada",
  "Desierta"
];

function statusTone(estado?: string | null) {
  const normalized = String(estado || "").toLowerCase();
  if (normalized.includes("adjudicada") && !normalized.includes("no adjudicada")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("no cumple") || normalized.includes("no adjudicada") || normalized.includes("desierta")) return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized.includes("anuncio") || normalized.includes("abierta")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("cerrada")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (normalized.includes("evaluacion") || normalized.includes("enviada")) return "border-blue-200 bg-blue-50 text-blue-800";
  if (normalized.includes("cumple")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
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
  if (!date) return null;
  return (date.getTime() - Date.now()) / 36e5;
}

function sliOperationalAlert(item: Seguimiento, result?: SliLookupResult | null) {
  if (!result) return "";
  if (result.error) return result.error;
  if (result.requiere_revision_rfq) return result.nota_revision_rfq || "Revisar RFQ/pliego: el SLI no expone suficiente detalle.";
  const hours = hoursUntil(result.fecha_cierre);
  if (hours !== null && hours >= 0 && hours <= 72) return `Cierre cercano: quedan ${Math.max(1, Math.round(hours))} hora(s).`;
  const publication = String(result.fecha_publicacion || "").trim();
  const revision = String(result.ultima_revision || "").trim();
  if (publication && revision && publication !== revision) return "Tiene revision posterior a la publicacion; validar si hubo cambio o enmienda.";
  const suggested = suggestedEstadoFromSli(result, item.estado || "En Preparacion");
  if (suggested && suggested !== item.estado) return `SLI sugiere cambiar estado a ${suggested}.`;
  return "";
}

function cleanRfq(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function sliTone(status?: string | null) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("abierta")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("adjudic")) return "border-blue-200 bg-blue-50 text-blue-800";
  if (normalized.includes("desierta") || normalized.includes("cancel")) return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized.includes("cerrada") || normalized.includes("evalu")) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function suggestedEstadoFromSli(result?: SliLookupResult | null, current = "En Preparacion") {
  const status = String(result?.estatus || "").toLowerCase();
  if (!status) return "";
  if (status.includes("adjudic")) return "Adjudicada";
  if (status.includes("desierta")) return "Desierta";
  if (status.includes("evalu") || status.includes("cerrada")) return "En Evaluacion Economica";
  if (status.includes("anuncio")) return "ANUNCIO";
  if (status.includes("abierta")) return current.includes("Oferta Enviada") ? current : "ABIERTA";
  return "";
}

function matchesSearch(item: Seguimiento, query: string) {
  if (!query.trim()) return true;
  const haystack = [
    item.numero_licitacion,
    item.objeto,
    item.estado,
    item.responsable,
    item.owner_username,
    item.notas,
    item.fecha_registro
  ].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

export function SeguimientoConsole({ user }: { user: AuthUser }) {
  const isGlobalViewer = user.role === "Supervisor" || user.role === "Gerencia";
  const [items, setItems] = useState<Seguimiento[]>([]);
  const [selected, setSelected] = useState<Seguimiento | null>(null);
  const [historial, setHistorial] = useState<SeguimientoHistorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ numero_licitacion: "", objeto: "", responsable: user.username, notas: "" });
  const [notaEstado, setNotaEstado] = useState("");
  const [search, setSearch] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("Todos");
  const autoSliCheckedRef = useRef(false);
  const [sliResults, setSliResults] = useState<Record<number, SliLookupResult>>({});
  const [sliLoading, setSliLoading] = useState<Record<number, boolean>>({});
  const [sliErrors, setSliErrors] = useState<Record<number, string>>({});
  const [sliSyncMeta, setSliSyncMeta] = useState<Record<number, { checkedAt: string; suggested?: string; alert?: string; changed?: boolean }>>({});
  const [bulkSync, setBulkSync] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const response = await getSeguimientos({ username: user.username, role: user.role });
      setItems(response.seguimientos || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar seguimiento.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [user.username, user.role]);

  async function openItem(item: Seguimiento) {
    setSelected(item);
    setNotaEstado("");
    if (!sliResults[item.id]) void checkSli(item, true);
    try {
      const response = await getSeguimientoHistorial(item.id);
      setHistorial(response.historial || []);
    } catch {
      setHistorial([]);
    }
  }

  async function createItem() {
    setError(null);
    const numero = cleanRfq(form.numero_licitacion);
    if (!numero) {
      setError("Ingresa un numero de licitacion valido antes de agregarlo a seguimiento.");
      return;
    }
    try {
      const response = await createSeguimiento({
        ...form,
        numero_licitacion: numero,
        owner_username: user.username,
        responsable: form.responsable || user.username,
        moneda: "USD",
        monto_ofertado: 0
      });
      const saved = response.seguimiento;
      if (saved) {
        setItems((current) => {
          const exists = current.some((row) => row.id === saved.id);
          return exists ? current.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...current];
        });
        setSelected(saved);
      }
      setForm({ numero_licitacion: "", objeto: "", responsable: user.username, notas: "" });
      setSearch("");
      setEstadoFilter("Todos");
      await refresh();
      if (saved) await openItem(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear seguimiento.");
    }
  }

  async function saveComment(item: Seguimiento) {
    const note = notaEstado.trim();
    if (!note) return;
    setError(null);
    try {
      await updateSeguimientoEstado(item.id, {
        estado: item.estado || "En Preparacion",
        nota: note,
        registrado_por: user.username
      });
      const updated = {
        ...item,
        notas: item.notas ? `${item.notas} | ${note}` : note
      };
      setItems((current) => current.map((row) => (row.id === item.id ? updated : row)));
      setNotaEstado("");
      await refresh();
      await openItem(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el comentario.");
    }
  }

  async function checkSli(item: Seguimiento, syncEstado = false) {
    const rfq = cleanRfq(item.numero_licitacion);
    if (!rfq) {
      setSliErrors((current) => ({ ...current, [item.id]: "Numero de licitacion invalido para consultar SLI." }));
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
      const alert = sliOperationalAlert(item, result);
      setSliResults((current) => ({ ...current, [item.id]: result }));
      setSliSyncMeta((current) => ({
        ...current,
        [item.id]: {
          checkedAt: new Date().toISOString(),
          suggested,
          alert,
          changed: Boolean(suggested && suggested !== item.estado)
        }
      }));
      if (result.error) {
        setSliErrors((current) => ({ ...current, [item.id]: result.error || "SLI respondio con advertencia." }));
      }

      if (syncEstado && suggested && suggested !== item.estado) {
        const note = [
          `Sincronizado con SLI: ${result.estatus || "estado no especificado"}.`,
          result.fecha_cierre ? `Cierre SLI: ${result.fecha_cierre}.` : "",
          result.codigos_acp_detectados?.length ? `Codigos detectados: ${result.codigos_acp_detectados.join(", ")}.` : ""
        ].filter(Boolean).join(" ");
        await updateSeguimientoEstado(item.id, { estado: suggested, nota: note, registrado_por: user.username });
        const updated = {
          ...item,
          estado: suggested,
          notas: item.notas ? `${item.notas} | ${note}` : note
        };
        setItems((current) => current.map((row) => (row.id === item.id ? updated : row)));
        if (selected?.id === item.id) {
          setSelected(updated);
          const history = await getSeguimientoHistorial(item.id);
          setHistorial(history.historial || []);
        }
      }
    } catch (err) {
      setSliErrors((current) => ({
        ...current,
        [item.id]: err instanceof Error ? err.message : "No se pudo consultar el SLI."
      }));
    } finally {
      setSliLoading((current) => ({ ...current, [item.id]: false }));
    }
  }

  async function removeItem(item: Seguimiento) {
    setError(null);
    try {
      await deleteSeguimiento(item.id);
      setItems((current) => current.filter((row) => row.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar seguimiento.");
    }
  }

  const estados = useMemo(() => {
    const dynamicStates = items.map((item) => String(item.estado || "").trim()).filter(Boolean);
    return Array.from(new Set([...estadosBase, ...dynamicStates]));
  }, [items]);
  const filteredItems = useMemo(() => {
    return items
      .filter((item) => estadoFilter === "Todos" || item.estado === estadoFilter)
      .filter((item) => matchesSearch(item, search))
      .sort((a, b) => String(b.fecha_registro || "").localeCompare(String(a.fecha_registro || "")));
  }, [estadoFilter, items, search]);
  const activeCount = items.filter((item) => !["Adjudicada", "No Adjudicada", "Desierta"].includes(String(item.estado || ""))).length;
  const closedCount = items.length - activeCount;
  const sliCheckedCount = Object.keys(sliResults).length;
  const sliAlertCount = items.filter((item) => sliOperationalAlert(item, sliResults[item.id])).length;
  const closeSoonCount = Object.values(sliResults).filter((result) => {
    const hours = hoursUntil(result.fecha_cierre);
    return hours !== null && hours >= 0 && hours <= 72;
  }).length;
  const revisionAlertCount = Object.values(sliResults).filter((result) => {
    const publication = String(result.fecha_publicacion || "").trim();
    const revision = String(result.ultima_revision || "").trim();
    return publication && revision && publication !== revision;
  }).length;
  const myItemsCount = items.filter((item) => (item.owner_username || item.responsable) === user.username).length;
  const priorityItems = filteredItems
    .map((item) => {
      const result = sliResults[item.id];
      const meta = sliSyncMeta[item.id];
      const alert = sliOperationalAlert(item, result);
      const hours = hoursUntil(result?.fecha_cierre);
      const closeSoon = hours !== null && hours >= 0 && hours <= 72;
      const changed = Boolean(meta?.changed);
      const errorText = sliErrors[item.id];
      const title = closeSoon
        ? "Cierre cercano"
        : changed
          ? "Cambio sugerido por SLI"
          : errorText
            ? "SLI requiere revision"
            : alert
              ? "Revisar proceso"
              : "";
      const tone = closeSoon || errorText ? "rose" : changed || alert ? "amber" : "neutral";
      const detail = closeSoon
        ? `Cierra en ${Math.max(1, Math.round(hours || 1))} hora(s).`
        : changed
          ? `SLI sugiere: ${meta?.suggested || "revisar estado"}.`
          : errorText || alert;
      return title ? { item, title, detail, tone } : null;
    })
    .filter(Boolean)
    .slice(0, 6) as Array<{ item: Seguimiento; title: string; detail?: string; tone: string }>;
  useEffect(() => {
    if (loading || autoSliCheckedRef.current || !filteredItems.length) return;
    autoSliCheckedRef.current = true;
    const timer = window.setTimeout(() => {
      void checkVisibleSli(8);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [filteredItems, loading]);

  const summaryCards = [
    { label: "Activos", value: activeCount, detail: "Procesos vivos", className: "border-blue-200 bg-blue-50 text-blue-900" },
    { label: "Cerrados", value: closedCount, detail: "Adjudicados, no adjudicados o desiertos", className: "border-slate-200 bg-slate-50 text-slate-800" },
    { label: "Alertas SLI", value: sliAlertCount, detail: `${sliCheckedCount} consultados`, className: sliAlertCount ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900" },
    { label: "Cierre 72h", value: closeSoonCount, detail: "Procesos urgentes", className: closeSoonCount ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900" },
    { label: "Revisiones", value: revisionAlertCount, detail: "Posibles cambios/enmiendas", className: revisionAlertCount ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-800" },
    {
      label: isGlobalViewer ? "Vista global" : "Mis procesos",
      value: isGlobalViewer ? items.length : myItemsCount,
      detail: isGlobalViewer ? "Supervisor/Gerencia" : user.username,
      className: "border-violet-200 bg-violet-50 text-violet-900"
    }
  ];

  async function checkVisibleSli(limit = 20) {
    const candidates = filteredItems.filter((item) => cleanRfq(item.numero_licitacion)).slice(0, limit);
    if (!candidates.length) {
      setError("No hay licitaciones visibles con numero valido para consultar en SLI.");
      return;
    }
    setError(null);
    setBulkSync({ running: true, done: 0, total: candidates.length });
    try {
      for (const item of candidates) {
        await checkSli(item, true);
        setBulkSync((current) => ({ ...current, done: current.done + 1 }));
      }
    } finally {
      setBulkSync((current) => ({ ...current, running: false }));
    }
  }

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Seguimiento"
          title="Pipeline de licitaciones"
          copy="Control operativo de procesos enviados, evaluacion tecnica/economica, adjudicaciones y comentarios sincronizados con SLI cuando sea posible."
          actions={loading ? <Loader2 className="h-5 w-5 animate-spin text-brand" /> : null}
        />
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          <StatusBadge tone="info">{activeCount} activos</StatusBadge>
          <StatusBadge tone="neutral">{closedCount} cerrados</StatusBadge>
          <StatusBadge tone="neutral">SLI {sliCheckedCount} consultados</StatusBadge>
          {sliAlertCount ? <StatusBadge tone="warn">{sliAlertCount} requieren revisar RFQ</StatusBadge> : null}
        </div>
      </ModuleSection>

      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <div key={card.label} className={`rounded-xl border p-4 shadow-sm ${card.className}`}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold">{card.value}</div>
            <div className="mt-1 text-xs opacity-75">{card.detail}</div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Prioridades de seguimiento</div>
            <p className="mt-1 text-sm text-muted">Procesos que requieren accion por cierre, cambio SLI, revision o error de consulta.</p>
          </div>
          <StatusBadge tone={priorityItems.length ? "warn" : "ok"}>{priorityItems.length ? `${priorityItems.length} prioridad(es)` : "Sin urgencias"}</StatusBadge>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {priorityItems.length ? priorityItems.map(({ item, title, detail, tone }) => (
            <button
              key={`priority-${item.id}`}
              type="button"
              onClick={() => void openItem(item)}
              className={`rounded-xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                tone === "rose"
                  ? "border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100"
                  : tone === "amber"
                    ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    : "border-line bg-white text-slate-800 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-wide opacity-75">{title}</div>
                  <div className="mt-1 text-sm font-semibold leading-5">{item.numero_licitacion} | {item.objeto || "Sin objeto"}</div>
                  {detail ? <p className="mt-2 text-xs leading-5 opacity-85">{detail}</p> : null}
                </div>
                <BellRing className="h-4 w-4 shrink-0" />
              </div>
            </button>
          )) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900 lg:col-span-2 2xl:col-span-3">
              No hay prioridades críticas detectadas en los procesos visibles. Puedes sincronizar SLI para refrescar el estado.
            </div>
          )}
        </div>
      </section>

      <details className="rounded-xl border border-line bg-panel shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
          <div>
            <div className="text-sm font-semibold text-slate-900">Agregar licitacion manual</div>
            <p className="mt-1 text-sm text-muted">Usalo solo si el proceso no viene desde el Radar o desde un RFQ.</p>
          </div>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            Crear
          </span>
        </summary>
        <div className="grid gap-3 border-t border-line p-5 lg:grid-cols-[0.35fr_1fr_0.4fr_1fr_auto]">
          <input value={form.numero_licitacion} onChange={(event) => setForm((current) => ({ ...current, numero_licitacion: event.target.value }))} placeholder="RFQ" className="app-input" />
          <input value={form.objeto} onChange={(event) => setForm((current) => ({ ...current, objeto: event.target.value }))} placeholder="Objeto" className="app-input" />
          <input value={form.responsable} onChange={(event) => setForm((current) => ({ ...current, responsable: event.target.value }))} placeholder="Responsable" className="app-input" />
          <input value={form.notas} onChange={(event) => setForm((current) => ({ ...current, notas: event.target.value }))} placeholder="Notas iniciales" className="app-input" />
          <Button type="button" onClick={createItem} variant="primary" size="lg">
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>
      </details>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Pipeline operativo</div>
              <p className="mt-1 text-xs text-muted">
                {filteredItems.length} procesos visibles de {items.length} registrados. Atiende primero los procesos marcados por SLI o por cierre cercano.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void checkVisibleSli()}
                disabled={loading || bulkSync.running}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
              >
                {bulkSync.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                {bulkSync.running ? `SLI ${bulkSync.done}/${bulkSync.total}` : "Sincronizar SLI"}
              </button>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-brand disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Actualizar
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_240px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar RFQ, objeto, responsable, comentario o estado..."
                className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <select
              value={estadoFilter}
              onChange={(event) => setEstadoFilter(event.target.value)}
              className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
            >
              <option value="Todos">Todos los estados</option>
              {estados.map((estado) => (
                <option key={estado} value={estado}>{estado}</option>
              ))}
            </select>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-line">
            {filteredItems.length ? (
              <div className="divide-y divide-line">
                {filteredItems.map((item) => (
                  <div key={item.id} className={`bg-white p-4 hover:bg-slate-50 ${selected?.id === item.id ? "bg-blue-50/60" : ""}`}>
                    <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                          <button type="button" onClick={() => openItem(item)} className="shrink-0 text-left text-base font-semibold text-brand">
                            {item.numero_licitacion}
                          </button>
                          <button type="button" onClick={() => openItem(item)} className="block min-w-0 max-w-full text-left font-semibold leading-6 text-slate-900 hover:text-brand">
                            <span className="line-clamp-2 break-words">{item.objeto || "Sin objeto"}</span>
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span>{item.responsable || item.owner_username || "Sin responsable"}</span>
                          {isGlobalViewer && item.owner_username ? (
                            <>
                              <span className="text-slate-300">|</span>
                              <span>Usuario: {item.owner_username}</span>
                            </>
                          ) : null}
                          <span className="text-slate-300">|</span>
                          <span>{formatDate(item.fecha_registro)}</span>
                        </div>
                        {item.notas ? <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{item.notas}</div> : null}
                        {sliResults[item.id] || sliErrors[item.id] ? (
                          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                            {sliResults[item.id] ? (
                              <>
                                <span className={`inline-flex max-w-full rounded-full border px-2.5 py-1 leading-4 ${sliTone(sliResults[item.id].estatus)}`}>
                                  SLI: {sliResults[item.id].estatus || "Sin estado"}
                                </span>
                                <span className="inline-flex max-w-full rounded-full border border-line bg-slate-50 px-2.5 py-1 leading-4 text-slate-700">
                                  Cierre: {sliResults[item.id].fecha_cierre || "N/D"}
                                </span>
                                {sliSyncMeta[item.id]?.checkedAt ? (
                                  <span className="inline-flex max-w-full rounded-full border border-line bg-white px-2.5 py-1 leading-4 text-slate-600">
                                    Sync: {formatDate(sliSyncMeta[item.id].checkedAt)}
                                  </span>
                                ) : null}
                                {sliResults[item.id].codigos_acp_detectados?.length ? (
                                  <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 leading-4 text-emerald-800">
                                    {sliResults[item.id].codigos_acp_detectados?.length} codigo(s) ACP
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                            {sliErrors[item.id] ? (
                              <span className="inline-flex max-w-full rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 leading-4 text-amber-800">
                                SLI: {sliErrors[item.id]}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {sliOperationalAlert(item, sliResults[item.id]) ? (
                          <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900">
                            <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{sliOperationalAlert(item, sliResults[item.id])}</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 shrink-0 flex-col gap-3 sm:flex-row sm:items-center 2xl:w-[330px] 2xl:max-w-full 2xl:justify-end">
                        <div className="app-data-card min-w-0 sm:flex-1 2xl:w-[230px] 2xl:flex-none">
                          <span className={`inline-flex max-w-full rounded-full border px-3 py-1 text-xs font-semibold leading-4 ${statusTone(item.estado)}`}>
                            <span className="break-words">{item.estado || "Pendiente SLI"}</span>
                          </span>
                          <div className="mt-2 text-xs leading-5 text-muted">
                            {sliResults[item.id]
                              ? `SLI sugiere: ${suggestedEstadoFromSli(sliResults[item.id], item.estado || "En Preparacion") || "sin cambio"}`
                              : "Estado definido por analisis SLI"}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2 sm:justify-end">
                          <button
                            type="button"
                            onClick={() => void checkSli(item, true)}
                            disabled={sliLoading[item.id]}
                            className="app-btn-mini h-9 w-11 border-blue-200 text-blue-700"
                            title="Analizar con SLI"
                          >
                            {sliLoading[item.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                          </button>
                          {item.link_sli && (
                            <a href={item.link_sli} target="_blank" rel="noreferrer" className="app-btn-mini h-9 w-11">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button type="button" onClick={() => removeItem(item)} className="app-btn-mini app-btn-danger h-9 w-11">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 p-5 text-sm text-muted">No hay licitaciones con esos filtros.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">{selected ? `Historial ${selected.numero_licitacion}` : "Detalle"}</div>
          {selected ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={`rounded-lg border p-3 ${statusTone(selected.estado)}`}>
                  <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Estado actual</div>
                  <div className="mt-1 text-sm font-semibold">{selected.estado || "En Preparacion"}</div>
                </div>
                <div className="app-data-card text-slate-800">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Registro
                  </div>
                  <div className="mt-1 text-sm font-semibold">{formatDate(selected.fecha_registro)}</div>
                </div>
              </div>
              {selected.notas ? (
                <div className="app-data-card">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">Notas acumuladas</div>
                  <div className="mt-1 text-sm leading-6 text-slate-700">{selected.notas}</div>
                </div>
              ) : null}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Analisis automatico SLI</div>
                    <p className="mt-1 leading-6">
                      El estado de seguimiento se calcula desde el SLI. Los usuarios pueden agregar comentarios, pero no cambiar manualmente el estado.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void checkSli(selected, true)}
                    disabled={sliLoading[selected.id]}
                    className="app-btn-mini border-blue-200 text-blue-800 disabled:opacity-60"
                  >
                    {sliLoading[selected.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                    Analizar con SLI
                  </button>
                </div>
              </div>
              {sliResults[selected.id] || sliErrors[selected.id] ? (
                <div className={`rounded-lg border p-3 text-sm ${sliResults[selected.id] ? sliTone(sliResults[selected.id].estatus) : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Estado SLI conectado</div>
                      <div className="mt-1 font-semibold">{sliResults[selected.id]?.estatus || sliErrors[selected.id] || "Sin respuesta"}</div>
                      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        <span>Publicacion: {sliResults[selected.id]?.fecha_publicacion || "N/D"}</span>
                        <span>Ultima revision: {sliResults[selected.id]?.ultima_revision || "N/D"}</span>
                        <span>Cierre: {sliResults[selected.id]?.fecha_cierre || "N/D"}</span>
                        <span>Agente: {sliResults[selected.id]?.agente_compras || "N/D"}</span>
                        <span>Codigos ACP: {sliResults[selected.id]?.codigos_acp_detectados?.length || 0}</span>
                        <span>Sincronizado: {sliSyncMeta[selected.id]?.checkedAt ? formatDate(sliSyncMeta[selected.id].checkedAt) : "N/D"}</span>
                      </div>
                      {sliResults[selected.id]?.descripcion ? (
                        <p className="mt-1 leading-6">{sliResults[selected.id].descripcion}</p>
                      ) : null}
                    </div>
                    <span className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-800">
                      Estado calculado: {suggestedEstadoFromSli(sliResults[selected.id], selected.estado || "En Preparacion") || selected.estado || "Pendiente"}
                    </span>
                  </div>
                  {sliOperationalAlert(selected, sliResults[selected.id]) ? (
                    <div className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-white/70 p-2 text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{sliOperationalAlert(selected, sliResults[selected.id])}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-2">
                <textarea value={notaEstado} onChange={(event) => setNotaEstado(event.target.value)} placeholder="Agregar comentario de seguimiento sin cambiar el estado calculado por SLI" className="min-h-24 w-full rounded-lg border border-line bg-white px-3 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100" />
                <button
                  type="button"
                  onClick={() => void saveComment(selected)}
                  disabled={!notaEstado.trim()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-brand bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Guardar comentario
                </button>
              </div>
              <div className="space-y-3">
                {historial.map((row, index) => (
                  <div key={index} className="app-data-card">
                    <div className="text-sm font-semibold text-slate-900">{row.estado_nuevo}</div>
                    <div className="mt-1 text-xs text-muted">{row.fecha} | {row.registrado_por || "Sistema"}</div>
                    {row.nota && <div className="mt-2 text-sm leading-6 text-slate-700">{row.nota}</div>}
                  </div>
                ))}
                {!historial.length && <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-muted">Sin historial registrado.</div>}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-muted">Selecciona una licitacion para ver comentarios e historial.</div>
          )}
        </div>
      </section>
    </div>
  );
}



