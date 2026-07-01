"use client";

import { AlertTriangle, BarChart3, CheckCircle2, ClipboardList, FileText, FolderOpen, PackageSearch, Radar, RefreshCw, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { getRadarLicitaciones, getRadarScheduler, radarFlag, type RadarSchedulerStatus } from "@/lib/radar";
import { cleanValue, loadLastRfq, type RfqAnalysisResponse } from "@/lib/rfq";
import { getAllowedModules, type ModuleId } from "@/lib/navigation";
import { listWorkspaces, type WorkspaceListItem } from "@/lib/workspaces";

type DashboardCard = {
  module: ModuleId;
  title: string;
  copy: string;
  icon: LucideIcon;
};

const quickActions: DashboardCard[] = [
  { module: "rfq", title: "Analizar RFQ", copy: "Cargar pliego, anexos y matriz tecnica.", icon: FileText },
  { module: "proveedores", title: "Buscar proveedores", copy: "Sourcing global por renglon.", icon: PackageSearch },
  { module: "auditor_empresas", title: "Auditar proveedor", copy: "Validar riesgo comercial.", icon: ShieldCheck },
  { module: "costos", title: "Comparar costos", copy: "Historico y referencia de precio.", icon: BarChart3 },
  { module: "logistica", title: "Calcular logistica", copy: "Peso, dimensiones, forwarder e incoterm.", icon: Truck },
  { module: "radar", title: "Revisar Radar", copy: "Licitaciones abiertas y enmiendas.", icon: Radar },
  { module: "seguimiento", title: "Seguimiento", copy: "Estados y comentarios operativos.", icon: ClipboardList },
  { module: "workspaces", title: "Abrir workspace", copy: "Recuperar analisis guardados.", icon: FolderOpen }
];

function roleIntro(role: string) {
  if (role === "Supervisor") {
    return {
      title: "Centro supervisor",
      subtitle: "Prioriza licitaciones abiertas, revisa enmiendas y entra rapido al flujo de analisis."
    };
  }
  if (role === "Gerencia") {
    return {
      title: "Vista gerencial",
      subtitle: "Resumen para decidir carga operativa, oportunidades, costos y salud del sistema."
    };
  }
  return {
    title: "Mesa de analisis",
    subtitle: "Tu punto de entrada para RFQ, costos, proveedores, historico y seguimiento."
  };
}

function formatDate(value?: string | null) {
  if (!value) return "N/D";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function RoleHome({ user, onModuleChange }: { user: AuthUser; onModuleChange?: (moduleId: ModuleId) => void }) {
  const role = normalizeRole(user.role);
  const intro = roleIntro(role);
  const allowed = useMemo(() => new Set(getAllowedModules(user).map((item) => item.id)), [user]);
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [radarStats, setRadarStats] = useState({ total: 0, alertas: 0, seguimiento: 0, cierre72h: 0 });
  const [scheduler, setScheduler] = useState<RadarSchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setRfq(loadLastRfq(user.username));
  }, [user.username]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const tasks: Array<Promise<unknown>> = [
      listWorkspaces(user.username, role === "Gerencia")
        .then((response) => {
          if (mounted) setWorkspaces(response.workspaces || []);
        })
        .catch(() => {
          if (mounted) setWorkspaces([]);
        })
    ];

    if (allowed.has("radar")) {
      tasks.push(
        getRadarLicitaciones({ limit: 150 })
          .then((response) => {
            if (!mounted) return;
            const items = response.items || [];
            const now = Date.now();
            setRadarStats({
              total: response.total || items.length,
              alertas: items.filter((item) => radarFlag(item.enmienda_alerta)).length,
              seguimiento: items.filter((item) => item.estado_radar === "en_seguimiento").length,
              cierre72h: items.filter((item) => {
                const time = item.fecha_cierre_iso ? new Date(item.fecha_cierre_iso).getTime() : 0;
                return time >= now && time <= now + 72 * 60 * 60 * 1000;
              }).length
            });
          })
          .catch(() => {
            if (mounted) setRadarStats({ total: 0, alertas: 0, seguimiento: 0, cierre72h: 0 });
          })
      );
      tasks.push(
        getRadarScheduler()
          .then((response) => {
            if (mounted) setScheduler(response);
          })
          .catch(() => {
            if (mounted) setScheduler(null);
          })
      );
    }

    Promise.allSettled(tasks).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [allowed, role, user.username]);

  const items = rfq?.items || [];
  const cg = (rfq?.condiciones_generales || {}) as Record<string, unknown>;
  const rfqNumber = cleanValue(cg.numero_licitacion || cg.licitacion, "Sin RFQ activo");
  const filteredActions = quickActions.filter((action) => allowed.has(action.module));
  const lastWorkspace = [...workspaces].sort((a, b) => new Date(b.fecha_guardado || 0).getTime() - new Date(a.fecha_guardado || 0).getTime())[0];
  const summaryCards: Array<[string, string, string, LucideIcon]> = [
    ["RFQ activo", rfqNumber, `${items.length} renglones cargados`, FileText],
    ["Workspaces", String(workspaces.length), lastWorkspace ? `Ultimo: ${lastWorkspace.licitacion}` : "Sin guardados", FolderOpen],
    ["Radar abierto", allowed.has("radar") ? String(radarStats.total) : "N/D", allowed.has("radar") ? `${radarStats.alertas} alertas de enmienda` : "No aplica al rol", Radar],
    ["Scheduler", scheduler?.enabled === false ? "Apagado" : `${scheduler?.interval_minutes || 25} min`, scheduler?.last_finished ? `Ultimo: ${formatDate(scheduler.last_finished)}` : "Sin escaneo reciente", CheckCircle2]
  ];

  return (
    <div className="space-y-5">
      <section className="app-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-blue-100">Dashboard | {role}</div>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight text-white">{intro.title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">{intro.subtitle}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white">
            <RefreshCw className={`h-4 w-4 text-blue-100 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Actualizando" : "Datos cargados"}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(([label, value, hint, Icon]) => (
          <div key={String(label)} className="app-stat-card rounded-xl border border-line bg-panel p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
              <Icon className="h-4 w-4 text-brand" />
            </div>
            <div className="mt-2 truncate text-xl font-semibold text-slate-900">{String(value)}</div>
            <div className="mt-1 text-xs leading-5 text-muted">{String(hint)}</div>
          </div>
        ))}
      </section>

      {allowed.has("radar") && (radarStats.alertas || radarStats.cierre72h) ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Atencion del Radar</div>
              <p className="mt-1 leading-6">
                Hay {radarStats.alertas} alerta(s) de enmienda y {radarStats.cierre72h} licitacion(es) cerrando en 72 horas.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="app-card p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Accesos de trabajo</div>
            <p className="mt-1 text-sm text-muted">Solo se muestran las funciones permitidas para tu rol.</p>
          </div>
          <div className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            {filteredActions.length} modulos
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredActions.map((action) => (
            <button
              key={action.module}
              type="button"
              onClick={() => onModuleChange?.(action.module)}
              className="app-module-tile rounded-xl border border-line bg-white p-4 text-left shadow-sm transition"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white">
                  <action.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-slate-900">{action.title}</span>
                  <span className="mt-1 block text-sm leading-5 text-muted">{action.copy}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="app-card p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">RFQ activo</div>
          {rfq ? (
            <div className="mt-4 space-y-3">
              {[
                ["Licitacion", rfqNumber],
                ["Renglones", String(items.length)],
                ["Garantia", cleanValue(cg.garantia_exigida || cg.garantia, "N/D")],
                ["Entrega", cleanValue(cg.tiempo_de_entrega_global || cg.tiempo_entrega, "N/D")]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-muted">
              No hay RFQ activo. Puedes analizar uno nuevo o abrir un workspace guardado.
            </div>
          )}
        </div>

        <div className="app-card p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Workspaces recientes</div>
          <div className="mt-4 space-y-2">
            {workspaces.slice(0, 5).map((item) => (
              <button
                key={`${item.username}-${item.licitacion}`}
                type="button"
                onClick={() => onModuleChange?.("workspaces")}
                className="app-row-button w-full rounded-lg border border-line bg-white p-3 text-left"
              >
                <div className="text-sm font-semibold text-slate-900">{item.licitacion}</div>
                <div className="mt-1 text-xs leading-5 text-muted">{item.username} | {formatDate(item.fecha_guardado)}</div>
              </button>
            ))}
            {!workspaces.length ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-muted">
              Aun no hay workspaces guardados.
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
