"use client";

import { AlertTriangle, BarChart3, CheckCircle2, ClipboardList, FileText, FolderOpen, PackageSearch, Radar, RefreshCw, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { getAllowedModules, type ModuleId } from "@/lib/navigation";
import { getRadarScheduler, getRadarStats, type RadarSchedulerStatus } from "@/lib/radar";
import { cleanValue, loadLastRfq, type RfqAnalysisResponse } from "@/lib/rfq";
import { formatCompactDate } from "@/lib/ui/format";
import { listWorkspaces, type WorkspaceListItem } from "@/lib/workspaces";

type DashboardAction = {
  module: ModuleId;
  title: string;
  copy: string;
  icon: LucideIcon;
  primary?: boolean;
};

const quickActions: DashboardAction[] = [
  { module: "rfq", title: "Analizar RFQ", copy: "Cargar pliego, anexos y matriz tecnica.", icon: FileText, primary: true },
  { module: "costos", title: "Comparar costos", copy: "Historico y referencia de precio.", icon: BarChart3 },
  { module: "proveedores", title: "Buscar proveedores", copy: "Sourcing global por renglon.", icon: PackageSearch },
  { module: "seguimiento", title: "Seguimiento", copy: "Estados SLI y comentarios operativos.", icon: ClipboardList },
  { module: "logistica", title: "Calcular logistica", copy: "Peso, dimensiones, forwarder e incoterm.", icon: Truck },
  { module: "radar", title: "Revisar Radar", copy: "Licitaciones abiertas y enmiendas.", icon: Radar },
  { module: "auditor_empresas", title: "Auditar proveedor", copy: "Validar riesgo comercial.", icon: ShieldCheck },
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
  if (role === "Logistica") {
    return {
      title: "Mesa logistica",
      subtitle: "Administra calculos, forwarders, dimensiones y referencias historicas."
    };
  }
  return {
    title: "Mesa de analisis",
    subtitle: "Empieza por el RFQ, revisa costos, busca proveedores y deja seguimiento claro."
  };
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
        getRadarStats()
          .then((response) => {
            if (!mounted) return;
            setRadarStats({
              total: response.total ?? 0,
              alertas: response.alertas ?? 0,
              seguimiento: response.en_seguimiento ?? 0,
              cierre72h: response.cierre_72h ?? 0,
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
  const primaryAction = filteredActions.find((action) => action.primary) || filteredActions[0];
  const secondaryActions = filteredActions.filter((action) => action.module !== primaryAction?.module);
  const lastWorkspace = [...workspaces].sort((a, b) => new Date(b.fecha_guardado || 0).getTime() - new Date(a.fecha_guardado || 0).getTime())[0];

  return (
    <div className="space-y-5">
      <ModuleSection className="bg-white">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">Dashboard | {role}</StatusBadge>
              <StatusBadge tone={loading ? "warn" : "ok"}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Actualizando" : "Listo"}
              </StatusBadge>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{intro.title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{intro.subtitle}</p>
          </div>
          {primaryAction ? (
            <Button variant="primary" size="lg" onClick={() => onModuleChange?.(primaryAction.module)}>
              <primaryAction.icon className="h-4 w-4" />
              {primaryAction.title}
            </Button>
          ) : null}
        </div>
      </ModuleSection>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard loading={loading} label="RFQ activo" value={rfqNumber} hint={`${items.length} renglones cargados`} icon={FileText} />
        <StatCard loading={loading} label="Workspaces" value={workspaces.length} hint={lastWorkspace ? `Ultimo: ${lastWorkspace.licitacion}` : "Sin guardados"} icon={FolderOpen} />
        <StatCard loading={loading} label="Radar abierto" value={allowed.has("radar") ? radarStats.total : "N/D"} hint={allowed.has("radar") ? `${radarStats.alertas} alertas de enmienda` : "No aplica al rol"} icon={Radar} />
        <StatCard loading={loading} label="Scheduler" value={scheduler?.enabled === false ? "Apagado" : `${scheduler?.interval_minutes || 25} min`} hint={scheduler?.last_finished ? `Ultimo: ${formatCompactDate(scheduler.last_finished)}` : "Sin escaneo reciente"} icon={CheckCircle2} />
      </section>

      {allowed.has("radar") && (radarStats.alertas || radarStats.cierre72h) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Atencion del Radar</div>
              <p className="mt-1 leading-6">
                Hay {radarStats.alertas} alerta(s) de enmienda y {radarStats.cierre72h} licitacion(es) cerrando en 72 horas.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <ModuleSection>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-950">Accesos de trabajo</div>
            <p className="mt-1 text-sm text-muted">Solo se muestran las funciones permitidas para tu rol.</p>
          </div>
          <StatusBadge tone="neutral">{filteredActions.length} modulos</StatusBadge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {secondaryActions.map((action) => (
            <button
              key={action.module}
              type="button"
              onClick={() => onModuleChange?.(action.module)}
              className="group rounded-xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/50 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-brand transition group-hover:bg-brand group-hover:text-white">
                  <action.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 pr-10">
                  <span className="block text-base font-semibold text-slate-950">{action.title}</span>
                  <span className="mt-1 block text-sm leading-5 text-muted">{action.copy}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </ModuleSection>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <ModuleSection>
          <div className="text-sm font-semibold text-slate-950">RFQ activo</div>
          {rfq ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["Licitacion", rfqNumber],
                ["Renglones", String(items.length)],
                ["Garantia", cleanValue(cg.garantia_exigida || cg.garantia, "N/D")],
                ["Entrega", cleanValue(cg.tiempo_de_entrega_global || cg.tiempo_entrega, "N/D")]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No hay RFQ activo" copy="Puedes analizar uno nuevo o abrir un workspace guardado." icon={FileText} className="mt-4" />
          )}
        </ModuleSection>

        <ModuleSection>
          <div className="text-sm font-semibold text-slate-950">Workspaces recientes</div>
          <div className="mt-4 space-y-2">
            {workspaces.slice(0, 5).map((item) => (
              <button
                key={`${item.username}-${item.licitacion}`}
                type="button"
                onClick={() => onModuleChange?.("workspaces")}
                className="w-full rounded-lg border border-line bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50"
              >
                <div className="text-sm font-semibold text-slate-950">{item.licitacion}</div>
                <div className="mt-1 text-xs leading-5 text-muted">{item.username} | {formatCompactDate(item.fecha_guardado)}</div>
              </button>
            ))}
            {!workspaces.length ? <EmptyState title="Sin workspaces" copy="Aun no hay analisis guardados para mostrar aqui." icon={FolderOpen} /> : null}
          </div>
        </ModuleSection>
      </section>
    </div>
  );
}
