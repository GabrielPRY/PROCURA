"use client";

import { AlertTriangle, ArrowRight, BarChart3, ClipboardList, FileText, FolderOpen, PackageSearch, Radar, RefreshCw, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { getAllowedModules, type ModuleId } from "@/lib/navigation";
import { getRadarStats } from "@/lib/radar";

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
  { module: "historico", title: "Consultar historico", copy: "Precios y participaciones corporativas.", icon: BarChart3 },
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

function roleWorkflow(role: string) {
  if (role === "Logistica") {
    return [
      { title: "Mantener tarifas", copy: "Actualiza forwarders y costos que utilizará todo el equipo." },
      { title: "Calcular embarque", copy: "Registra bultos, peso y dimensiones para obtener el costo estimado." },
      { title: "Consultar referencias", copy: "Revisa cálculos guardados e histórico antes de confirmar." }
    ];
  }
  if (role === "Supervisor" || role === "Gerencia") {
    return [
      { title: "Priorizar oportunidades", copy: "Revisa Radar, enmiendas y cierres próximos." },
      { title: "Validar el análisis", copy: "Abre el RFQ y confirma requisitos técnicos y comerciales." },
      { title: "Dar seguimiento", copy: "Consulta el estado real del SLI y los comentarios del equipo." }
    ];
  }
  return [
    { title: "Analizar RFQ", copy: "Carga el pliego y confirma requisitos por renglón." },
    { title: "Comparar costos", copy: "Consulta referencias históricas antes de definir el precio." },
    { title: "Buscar y contactar", copy: "Localiza proveedores y prepara el correo de cotización." },
    { title: "Dar seguimiento", copy: "Mantén visible el estado del proceso después de participar." }
  ];
}

export function RoleHome({ user, onModuleChange }: { user: AuthUser; onModuleChange?: (moduleId: ModuleId) => void }) {
  const role = normalizeRole(user.role);
  const intro = roleIntro(role);
  const workflow = roleWorkflow(role);
  const allowedModules = useMemo(() => getAllowedModules(user).map((item) => item.id), [user]);
  const allowed = useMemo(() => new Set(allowedModules), [allowedModules]);
  const [radarStats, setRadarStats] = useState({ total: 0, alertas: 0, seguimiento: 0, cierre72h: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const tasks: Array<Promise<unknown>> = [];

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
    }

    Promise.allSettled(tasks).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [allowed]);

  const filteredActions = quickActions.filter((action) => allowed.has(action.module));
  const defaultPrimary = filteredActions.find((action) => action.primary) || filteredActions[0];
  const primaryAction = role === "Logistica" && defaultPrimary?.module === "logistica"
    ? { ...defaultPrimary, title: "Gestionar logística", copy: "Tarifas globales y calculadora." }
    : defaultPrimary;
  const secondaryActions = filteredActions.filter((action) => action.module !== primaryAction?.module);
  const PrimaryIcon = primaryAction?.icon;
  const dashboardStats = allowed.has("radar")
    ? [
        { label: "Licitaciones abiertas", value: radarStats.total, hint: `${radarStats.cierre72h} cierran en 72 horas`, icon: Radar },
        { label: "En seguimiento", value: radarStats.seguimiento, hint: "Procesos activos del equipo", icon: ClipboardList },
        { label: "Enmiendas pendientes", value: radarStats.alertas, hint: "Cambios detectados por SLI", icon: AlertTriangle }
      ]
    : [];

  return (
    <div className="space-y-5">
      <ModuleSection className="app-dashboard-intro">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">Dashboard | {role}</StatusBadge>
              <StatusBadge tone={loading ? "warn" : "ok"}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Actualizando" : "Listo"}
              </StatusBadge>
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-ink">{intro.title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{intro.subtitle}</p>
          </div>
          {primaryAction && PrimaryIcon ? (
            <Button variant="primary" size="lg" onClick={() => onModuleChange?.(primaryAction.module)}>
              <PrimaryIcon className="h-4 w-4" />
              {primaryAction.title}
            </Button>
          ) : null}
        </div>
      </ModuleSection>

      {dashboardStats.length ? (
        <section className="grid gap-3 sm:grid-cols-3">
          {dashboardStats.map((stat) => (
            <StatCard key={stat.label} loading={loading} label={stat.label} value={stat.value} hint={stat.hint} icon={stat.icon} />
          ))}
        </section>
      ) : null}

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
        <div className="text-sm font-semibold text-ink">Ruta de trabajo</div>
        <p className="mt-1 text-sm text-muted">Un orden simple para completar el proceso sin saltar pasos importantes.</p>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {workflow.map((step, index) => (
            <li key={step.title} className="flex min-w-0 gap-3 border-l-2 border-blue-200 py-1 pl-3 dark:border-blue-500/40">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-brand dark:bg-blue-500/15">{index + 1}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{step.title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{step.copy}</span>
              </span>
            </li>
          ))}
        </ol>
      </ModuleSection>

      <section>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">Herramientas disponibles</div>
            <p className="mt-1 text-sm text-muted">Selecciona una herramienta para continuar.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {secondaryActions.map((action) => (
            <button
              key={action.module}
              type="button"
              onClick={() => onModuleChange?.(action.module)}
              className="app-action-card group relative w-full overflow-hidden p-4 text-left focus-visible:outline-none"
            >
              <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-brand transition group-hover:bg-brand group-hover:text-white">
                Abrir <ArrowRight className="h-3 w-3" />
              </span>
              <div className="flex items-start gap-3 pr-16">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-brand transition group-hover:bg-brand group-hover:text-white">
                  <action.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-ink">{action.title}</span>
                  <span className="mt-1 block text-sm leading-5 text-muted">{action.copy}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

