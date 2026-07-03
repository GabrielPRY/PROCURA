"use client";

import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, RefreshCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { asBool, cleanValue, saveLastRfq, type RfqAnalysisResponse } from "@/lib/rfq";
import { deleteWorkspace, listWorkspaces, loadWorkspace, type WorkspaceListItem } from "@/lib/workspaces";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type WorkspaceDetail = {
  data: Array<Record<string, unknown>>;
  cg: Record<string, unknown>;
  title: string;
  owner: string;
  licitacion: string;
};

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

function getCg(cg: Record<string, unknown>, keys: string[], fallback = "N/D") {
  for (const key of keys) {
    const value = cleanValue(cg[key], "");
    if (value) return value;
  }
  return fallback;
}

function getRow(row: Record<string, unknown>, keys: string[], fallback = "N/D") {
  for (const key of keys) {
    const value = cleanValue(row[key], "");
    if (value) return value;
  }
  return fallback;
}

function rowTone(row: Record<string, unknown>) {
  if (asBool(row.requiere_ficha_tecnica) || asBool(row.posible_obsolescencia)) return "border-amber-200 bg-amber-50 text-amber-800";
  if (asBool(row.requiere_propuesta_tecnica)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function rowStatus(row: Record<string, unknown>) {
  if (asBool(row.requiere_ficha_tecnica)) return "Ficha/catalogo";
  if (asBool(row.posible_obsolescencia)) return "Obsolescencia";
  if (asBool(row.requiere_propuesta_tecnica)) return "Propuesta";
  return "Normal";
}

export function WorkspacesConsole({ user, onOpenRfq }: { user: AuthUser; onOpenRfq?: () => void }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [selected, setSelected] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allUsers = normalizeRole(user.role) === "Gerencia";

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const response = await listWorkspaces(user.username, allUsers);
      setWorkspaces(response.workspaces || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los workspaces.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [user.username, allUsers]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return workspaces;
    return workspaces.filter((item) =>
      [item.licitacion, item.username, item.fecha_guardado].some((value) => String(value || "").toLowerCase().includes(term))
    );
  }, [workspaces, search]);

  const latest = useMemo(() => {
    return [...workspaces].sort((a, b) => new Date(b.fecha_guardado || 0).getTime() - new Date(a.fecha_guardado || 0).getTime())[0];
  }, [workspaces]);

  async function openWorkspace(item: WorkspaceListItem) {
    setError(null);
    setNotice(null);
    setOpening(true);
    try {
      const response = await loadWorkspace(item.username, item.licitacion);
      setSelected({
        data: ((response.data || []) as Array<Record<string, unknown>>),
        cg: response.condiciones_generales || {},
        title: `${item.licitacion} | ${item.username}`,
        owner: item.username,
        licitacion: item.licitacion
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el workspace.");
    } finally {
      setOpening(false);
    }
  }

  async function removeWorkspace(item: WorkspaceListItem) {
    setError(null);
    setNotice(null);
    try {
      await deleteWorkspace(item.username, item.licitacion);
      setWorkspaces((current) => current.filter((ws) => !(ws.username === item.username && ws.licitacion === item.licitacion)));
      if (selected?.owner === item.username && selected.licitacion === item.licitacion) setSelected(null);
      setNotice(`Workspace ${item.licitacion} eliminado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el workspace.");
    }
  }

  function restoreInRfq() {
    if (!selected) return;
    const payload: RfqAnalysisResponse = {
      condiciones_generales: selected.cg,
      items: selected.data
    };
    saveLastRfq(user.username, payload);
    setNotice(`Workspace ${selected.licitacion} restaurado como RFQ activo.`);
    onOpenRfq?.();
  }

  const selectedStats = selected
    ? [
        ["Renglones", String(selected.data.length)],
        ["Prop. tecnica", String(selected.data.filter((row) => asBool(row.requiere_propuesta_tecnica)).length)],
        ["Ficha/catalogo", String(selected.data.filter((row) => asBool(row.requiere_ficha_tecnica)).length)],
        ["Marca/restriccion", String(selected.data.filter((row) => cleanValue(row.marca_modelo_requerido, "")).length)]
      ]
    : [];

  const generalCards = selected
    ? [
        ["No. licitacion", getCg(selected.cg, ["numero_licitacion", "licitacion", "rfq_id"], selected.licitacion)],
        ["Garantia", getCg(selected.cg, ["garantia_exigida", "garantia", "garantias", "garantia_requerida"])],
        ["Lugar entrega", getCg(selected.cg, ["lugar_de_entrega", "lugar_entrega", "entrega"])],
        ["Tiempo entrega", getCg(selected.cg, ["tiempo_de_entrega_global", "tiempo_entrega", "plazo_entrega", "lead_time"])],
        ["Encargado ACP", getCg(selected.cg, ["persona_encargada_licitacion", "persona_encargada", "contacto_acp", "encargado_acp"])],
        ["Empresa sugerida", getCg(selected.cg, ["empresa_sugerida", "participar_con"], "Validar")]
      ]
    : [];

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Workspaces"
          title="Expedientes RFQ guardados"
          copy="Recupera analisis guardados, revisa su contexto y restaura el RFQ activo sin reprocesar documentos."
          actions={
            <Button type="button" onClick={refresh} disabled={loading} variant="secondary">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Actualizar
            </Button>
          }
        />
      </ModuleSection>

      <section className="grid gap-3 md:grid-cols-4">
        {[
          ["Guardados", String(workspaces.length)],
          ["Vista", allUsers ? "Equipo" : "Propios"],
          ["Mostrando", String(filtered.length)],
          ["Ultimo", latest ? formatDate(latest.fecha_guardado) : "Sin datos"]
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-panel p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{value}</div>
          </div>
        ))}
      </section>

      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}
      {notice && <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</section>}

      <section className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-slate-900">Expedientes guardados</div>
            {opening && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
          </div>
          <label className="relative mt-4 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por RFQ, usuario o fecha..."
              className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <div className="mt-4 rounded-xl border border-line bg-slate-50 p-2">
            {filtered.length ? (
              <div className="max-h-[620px] space-y-2 overflow-y-auto">
                {filtered.map((item) => {
                  const active = selected?.owner === item.username && selected.licitacion === item.licitacion;
                  return (
                    <div key={`${item.username}-${item.licitacion}`} className={`rounded-xl border p-4 transition ${active ? "border-blue-300 bg-blue-50 ring-2 ring-blue-100" : "border-line bg-white hover:border-blue-200 hover:bg-slate-50"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{item.licitacion}</div>
                          <div className="mt-1 text-xs text-muted">{item.username} | {formatDate(item.fecha_guardado)}</div>
                        </div>
                        {active ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" /> : <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" />}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openWorkspace(item)}
                          className="inline-flex items-center justify-center rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                        >
                          Abrir expediente
                        </button>
                        <button
                          type="button"
                          onClick={() => removeWorkspace(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Eliminar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-slate-50 p-5 text-sm text-muted">No hay workspaces con ese filtro.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">{selected?.title || "Detalle del workspace"}</div>
              <p className="mt-1 text-sm text-muted">Vista compacta para validar si este expediente es el que quieres continuar.</p>
            </div>
            {selected ? (
              <button
                type="button"
                onClick={restoreInRfq}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <FolderOpen className="h-4 w-4" />
                Abrir en RFQ
              </button>
            ) : null}
          </div>

          {selected ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {selectedStats.map(([label, value]) => (
                  <div key={label} className="app-data-card">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {generalCards.map(([label, value]) => (
                  <div key={label} className="app-data-card bg-white">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                    <div className="mt-2 text-sm font-semibold leading-5 text-slate-900">{value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-line bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Uso recomendado
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Si el expediente corresponde al RFQ que estas trabajando, abrelo en RFQ para recuperar la matriz, revisar renglones y continuar con correo, costos o proveedores.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Matriz tecnica del expediente</div>
                    <p className="mt-1 text-sm text-muted">Renglones guardados para continuar analisis, costos, correo o proveedores.</p>
                  </div>
                  <StatusBadge tone="info">{Math.min(selected.data.length, 80)} visibles</StatusBadge>
                </div>

                <div className="mt-4 grid gap-3">
                  {selected.data.slice(0, 80).map((row, index) => (
                    <article key={index} className="rounded-xl border border-line bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-800">R{getRow(row, ["renglon"], String(index + 1))}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{getRow(row, ["codigo_articulo", "codigo_acp"], "S/C")}</span>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${rowTone(row)}`}>{rowStatus(row)}</span>
                          </div>
                          <div className="mt-3 break-words text-sm font-semibold leading-6 text-slate-950">
                            {getRow(row, ["termino_de_busqueda_corto", "descripcion", "ficha_tecnica_completa"])}
                          </div>
                        </div>
                        <div className="grid min-w-[180px] gap-2 sm:grid-cols-2 lg:w-[260px]">
                          <div className="rounded-lg border border-line bg-white p-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Cantidad</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{getRow(row, ["cantidad"], "-")}</div>
                          </div>
                          <div className="rounded-lg border border-line bg-white p-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Unidad</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{getRow(row, ["unidad_de_medida", "unidad"], "-")}</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 rounded-lg border border-line bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Marca / restriccion</div>
                        <div className="mt-1 break-words text-sm leading-6 text-slate-700">{getRow(row, ["marca_modelo_requerido", "restriccion_marca_proveedor"], "No especificado")}</div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              {selected.data.length > 80 ? (
                <div className="text-xs text-muted">Mostrando 80 de {selected.data.length} renglones para mantener la vista rapida.</div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-muted">
              Selecciona un workspace para revisar datos generales, renglones y restaurarlo como RFQ activo.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}






