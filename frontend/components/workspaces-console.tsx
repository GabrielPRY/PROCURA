"use client";

import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCcw,
  Search,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { asBool, cleanValue, saveLastRfq, type RfqAnalysisResponse } from "@/lib/rfq";
import { deleteWorkspace, listWorkspaces, loadWorkspace, type WorkspaceListItem } from "@/lib/workspaces";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type WorkspaceDetail = {
  data: Array<Record<string, unknown>>;
  cg: Record<string, unknown>;
  item: WorkspaceListItem;
};

type BadgeTone = "neutral" | "info" | "ok" | "warn" | "danger";

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function normalizedRecord(record: Record<string, unknown>) {
  return new Map(Object.keys(record).map((key) => [key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase(), key]));
}

function recordValue(record: Record<string, unknown>, keys: string[], fallback = "N/D") {
  for (const key of keys) {
    const value = cleanValue(record[key], "");
    if (value) return value;
  }
  const normalized = normalizedRecord(record);
  for (const key of keys) {
    const actual = normalized.get(key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase());
    if (!actual) continue;
    const value = cleanValue(record[actual], "");
    if (value) return value;
  }
  return fallback;
}

function rowStatus(row: Record<string, unknown>): { label: string; tone: BadgeTone } {
  if (asBool(row.posible_obsolescencia)) return { label: "Obsolescencia", tone: "danger" };
  if (asBool(row.requiere_ficha_tecnica)) return { label: "Ficha requerida", tone: "warn" };
  if (asBool(row.requiere_propuesta_tecnica)) return { label: "Propuesta técnica", tone: "info" };
  return { label: "Sin alerta", tone: "neutral" };
}

function riskTone(value?: string): BadgeTone {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("alto")) return "danger";
  if (normalized.includes("medio")) return "warn";
  if (normalized.includes("bajo")) return "ok";
  return "neutral";
}

function workspaceTitle(item: WorkspaceListItem) {
  return cleanValue(item.objeto, `Licitación ${item.licitacion}`);
}

export function WorkspacesConsole({ user, onOpenRfq }: { user: AuthUser; onOpenRfq?: () => void }) {
  const role = normalizeRole(user.role);
  const allUsers = role === "Gerencia";
  const canRestoreRfq = role !== "Logistica";
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [selected, setSelected] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingKey, setOpeningKey] = useState("");
  const [search, setSearch] = useState("");
  const [rowSearch, setRowSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [deleteKey, setDeleteKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const response = await listWorkspaces(user.username, allUsers);
      setWorkspaces(response.workspaces || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los expedientes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.username, allUsers]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return workspaces;
    return workspaces.filter((item) => [
      item.licitacion,
      item.username,
      item.fecha_guardado,
      item.objeto,
      item.entidad,
      item.empresa_sugerida,
      item.riesgo
    ].some((value) => String(value || "").toLowerCase().includes(term)));
  }, [workspaces, search]);

  const owners = useMemo(() => new Set(workspaces.map((item) => item.username).filter(Boolean)).size, [workspaces]);

  async function openWorkspace(item: WorkspaceListItem) {
    const key = `${item.username}|${item.licitacion}`;
    setOpeningKey(key);
    setError(null);
    setNotice(null);
    setDeleteKey("");
    try {
      const response = await loadWorkspace(item.username, item.licitacion);
      setSelected({
        data: (response.data || []) as Array<Record<string, unknown>>,
        cg: response.condiciones_generales || {},
        item
      });
      setRowSearch("");
      setExpandedRow(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el expediente.");
    } finally {
      setOpeningKey("");
    }
  }

  async function removeWorkspace(item: WorkspaceListItem) {
    const key = `${item.username}|${item.licitacion}`;
    setError(null);
    try {
      await deleteWorkspace(item.username, item.licitacion);
      setWorkspaces((current) => current.filter((workspace) => `${workspace.username}|${workspace.licitacion}` !== key));
      if (selected && `${selected.item.username}|${selected.item.licitacion}` === key) setSelected(null);
      setDeleteKey("");
      setNotice(`Expediente ${item.licitacion} eliminado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el expediente.");
    }
  }

  function restoreInRfq() {
    if (!selected || !canRestoreRfq) return;
    const payload: RfqAnalysisResponse = {
      condiciones_generales: selected.cg,
      items: selected.data
    };
    saveLastRfq(user.username, payload);
    setNotice(`Expediente ${selected.item.licitacion} restaurado como RFQ activo.`);
    onOpenRfq?.();
  }

  const selectedRows = useMemo(() => {
    if (!selected) return [];
    const term = rowSearch.trim().toLowerCase();
    if (!term) return selected.data;
    return selected.data.filter((row) => Object.values(row).some((value) => String(value || "").toLowerCase().includes(term)));
  }, [selected, rowSearch]);

  const stats = selected ? {
    rows: selected.data.length,
    proposals: selected.data.filter((row) => asBool(row.requiere_propuesta_tecnica)).length,
    sheets: selected.data.filter((row) => asBool(row.requiere_ficha_tecnica)).length,
    restrictions: selected.data.filter((row) => cleanValue(row.marca_modelo_requerido || row.restriccion_marca_proveedor, "")).length
  } : null;

  const generalInfo = selected ? [
    ["Garantía", recordValue(selected.cg, ["garantia_exigida", "garantia", "garantias", "garantia_requerida"])],
    ["Lugar de entrega", recordValue(selected.cg, ["lugar_de_entrega", "lugar_entrega", "entrega"])],
    ["Tiempo de entrega", recordValue(selected.cg, ["tiempo_de_entrega_global", "tiempo_entrega", "plazo_entrega", "lead_time"])],
    ["Encargado ACP", recordValue(selected.cg, ["persona_encargada_licitacion", "persona_encargada", "contacto_acp", "encargado_acp"])],
    ["Empresa sugerida", recordValue(selected.cg, ["empresa_sugerida", "empresa_recomendada_participacion", "participar_con"], "Validar")],
    ["Presencia local", recordValue(selected.cg, ["requiere_presencia_local", "presencia_local"], "No determinada")]
  ] : [];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Expedientes"
          title="Espacios de trabajo guardados"
          copy="Recupera análisis RFQ sin volver a procesar documentos y entiende qué contiene cada expediente antes de abrirlo."
          actions={<Button type="button" onClick={refresh} disabled={loading} variant="secondary">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}Actualizar</Button>}
        />
      </ModuleSection>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{notice}</div> : null}

      <ModuleSection className="p-0">
        <div className="grid grid-cols-3 divide-x divide-line">
          <div className="p-4"><div className="text-xs font-semibold text-muted">Guardados</div><div className="mt-1 text-xl font-semibold text-ink">{workspaces.length}</div></div>
          <div className="p-4"><div className="text-xs font-semibold text-muted">Vista</div><div className="mt-1 text-sm font-semibold text-ink">{allUsers ? "Equipo" : "Mis expedientes"}</div></div>
          <div className="p-4"><div className="text-xs font-semibold text-muted">Propietarios</div><div className="mt-1 text-xl font-semibold text-ink">{owners}</div></div>
        </div>
      </ModuleSection>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <ModuleSection className="min-w-0 self-start p-0">
          <div className="border-b border-line p-4">
            <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-ink">{allUsers ? "Expedientes del equipo" : "Mis expedientes"}</h2>{loading ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <StatusBadge tone="info">{filtered.length}</StatusBadge>}</div>
            <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="app-input pl-9" placeholder="Licitación, objeto o responsable" /></label>
          </div>

          <div className="max-h-[660px] divide-y divide-line overflow-y-auto">
            {filtered.map((item) => {
              const key = `${item.username}|${item.licitacion}`;
              const active = selected && `${selected.item.username}|${selected.item.licitacion}` === key;
              const confirmingDelete = deleteKey === key;
              return (
                <div key={key} className={active ? "bg-blue-50" : "bg-panel"}>
                  <div className="flex items-stretch">
                    <button type="button" onClick={() => openWorkspace(item)} className="min-w-0 flex-1 p-4 text-left transition hover:bg-slate-50 focus-visible:outline-none">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${active ? "bg-blue-100 text-brand" : "bg-slate-50 text-muted"}`}>{openingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}</div>
                        <div className="min-w-0"><div className="break-words text-sm font-semibold leading-5 text-ink">{workspaceTitle(item)}</div><div className="mt-1 text-xs font-semibold text-brand">Lic. {item.licitacion}</div><div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted"><span>{item.renglones ?? 0} renglones</span><span>{formatDate(item.fecha_guardado)}</span>{allUsers ? <span>{item.username}</span> : null}</div></div>
                      </div>
                    </button>
                    <button type="button" onClick={() => setDeleteKey(confirmingDelete ? "" : key)} className="grid w-12 shrink-0 place-items-center border-l border-line text-muted transition hover:bg-rose-50 hover:text-rose-700" title="Eliminar expediente"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  {confirmingDelete ? <div className="flex items-center justify-between gap-3 border-t border-rose-200 bg-rose-50 p-3"><span className="text-xs font-semibold text-rose-800">¿Eliminar definitivamente?</span><div className="flex gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setDeleteKey("")}>Cancelar</Button><Button type="button" variant="danger" size="sm" onClick={() => removeWorkspace(item)}>Eliminar</Button></div></div> : null}
                </div>
              );
            })}
            {!filtered.length && !loading ? <EmptyState icon={FolderOpen} title="No hay expedientes con ese filtro" copy="Busca por número, objeto o responsable." /> : null}
          </div>
        </ModuleSection>

        <div className="min-w-0">
          {selected ? (
            <div className="space-y-5">
              <ModuleSection>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone="info">Lic. {selected.item.licitacion}</StatusBadge>{selected.item.riesgo ? <StatusBadge tone={riskTone(selected.item.riesgo)}>Riesgo {selected.item.riesgo}</StatusBadge> : null}</div><h2 className="mt-3 break-words text-xl font-semibold text-ink">{workspaceTitle(selected.item)}</h2><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted"><span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" />{cleanValue(selected.item.entidad, "ACP")}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-4 w-4" />{formatDate(selected.item.fecha_guardado)}</span><span>Responsable: {selected.item.username}</span></div></div>
                  {canRestoreRfq ? <Button type="button" variant="primary" size="lg" onClick={restoreInRfq}><FolderOpen className="h-4 w-4" />Continuar en RFQ</Button> : <StatusBadge tone="neutral">Consulta logística</StatusBadge>}
                </div>
              </ModuleSection>

              {stats ? <ModuleSection className="p-0"><div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">{[["Renglones", stats.rows], ["Propuesta técnica", stats.proposals], ["Ficha / catálogo", stats.sheets], ["Marca / restricción", stats.restrictions]].map(([label, value]) => <div key={String(label)} className="p-4"><div className="text-xs font-semibold text-muted">{label}</div><div className="mt-1 text-xl font-semibold text-ink">{value}</div></div>)}</div></ModuleSection> : null}

              <ModuleSection>
                <h3 className="text-sm font-semibold text-ink">Contexto de la licitación</h3>
                <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">{generalInfo.map(([label, value]) => <div key={label} className="border-t border-line pt-3"><div className="text-xs font-semibold text-muted">{label}</div><div className="mt-1 break-words text-sm font-semibold leading-6 text-ink">{value}</div></div>)}</div>
              </ModuleSection>

              <ModuleSection className="p-0">
                <div className="border-b border-line p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold text-ink">Renglones guardados</h3><p className="mt-1 text-xs text-muted">Abre únicamente el renglón que necesites revisar.</p></div><input value={rowSearch} onChange={(event) => setRowSearch(event.target.value)} className="app-input h-10 sm:w-64" placeholder="Código, marca o descripción" /></div></div>
                <div className="divide-y divide-line">
                  {selectedRows.slice(0, 100).map((row, index) => {
                    const status = rowStatus(row);
                    const open = expandedRow === index;
                    const description = recordValue(row, ["termino_de_busqueda_corto", "descripcion", "ficha_tecnica_completa"], "Sin descripción");
                    return <article key={`${recordValue(row, ["renglon"], String(index + 1))}-${index}`} className="bg-panel"><button type="button" onClick={() => setExpandedRow(open ? null : index)} className="grid w-full min-w-0 gap-3 p-4 text-left transition hover:bg-slate-50 sm:grid-cols-[62px_minmax(0,1fr)_120px_110px_32px] sm:items-center"><span className="text-sm font-semibold text-brand">R{recordValue(row, ["renglon"], String(index + 1))}</span><span className="min-w-0"><span className="block break-words text-sm font-semibold text-ink">{recordValue(row, ["codigo_articulo", "codigo_acp"], "S/C")}</span><span className="mt-1 block truncate text-xs text-muted">{description}</span></span><span className="text-sm text-ink">Cant. {recordValue(row, ["cantidad"], "-")}</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge>{open ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}</button>{open ? <div className="border-t border-line bg-slate-50 p-4"><div className="grid gap-4 md:grid-cols-2"><div><div className="text-xs font-semibold text-muted">Descripción técnica</div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{description}</p></div><div><div className="text-xs font-semibold text-muted">Marca o restricción</div><p className="mt-1 text-sm leading-6 text-ink">{recordValue(row, ["marca_modelo_requerido", "restriccion_marca_proveedor"], "No especificada")}</p><div className="mt-3 text-xs text-muted">Unidad: {recordValue(row, ["unidad_de_medida", "unidad"], "N/D")}</div></div></div></div> : null}</article>;
                  })}
                  {!selectedRows.length ? <EmptyState icon={FileText} title="No hay renglones con ese filtro" copy="Prueba con otro código, marca o descripción." /> : null}
                </div>
                {selectedRows.length > 100 ? <div className="border-t border-line p-3 text-xs text-muted">Mostrando 100 de {selectedRows.length} renglones para conservar el rendimiento.</div> : null}
              </ModuleSection>
            </div>
          ) : <ModuleSection><EmptyState icon={FolderOpen} title="Selecciona un expediente" copy="Verás el objeto, datos críticos y renglones antes de decidir si continuarlo." /></ModuleSection>}
        </div>
      </div>
    </div>
  );
}
