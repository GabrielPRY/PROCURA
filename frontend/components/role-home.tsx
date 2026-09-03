"use client";

import { AlertTriangle, ArrowRight, BarChart3, ClipboardList, DollarSign, FileText, FolderOpen, Gauge, PackageSearch, Radar, Settings, ShieldCheck, Truck, Users, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { getAllowedModules, type ModuleId } from "@/lib/navigation";
import { getRadarStats } from "@/lib/radar";
import { getLogisticsCalculations, getLogisticsCarriersStatus, getLogisticsSettings } from "@/lib/logistics";
import { loadLastRfq, type RfqAnalysisResponse } from "@/lib/rfq";
import { getSeguimientos } from "@/lib/seguimiento";
import { listWorkspaces } from "@/lib/workspaces";
import { getUsageMetrics } from "@/lib/metrics";
import { getAdminUsers, getTelegramNotificationStatus } from "@/lib/admin";

type DashboardAction = {
  module: ModuleId;
  title: string;
  copy: string;
  icon: LucideIcon;
};

const actions: Record<ModuleId, DashboardAction> = {
  dashboard: { module: "dashboard", title: "Dashboard", copy: "Resumen de trabajo.", icon: BarChart3 },
  rfq: { module: "rfq", title: "Analizar RFQ", copy: "Carga el pliego y revisa sus renglones.", icon: FileText },
  evaluacion: { module: "evaluacion", title: "Evaluación", copy: "Compara propuestas.", icon: ShieldCheck },
  ai_command: { module: "ai_command", title: "Centro IA", copy: "Consulta de procura.", icon: ShieldCheck },
  costos: { module: "costos", title: "Comparar costos", copy: "Revisa precios y participaciones anteriores.", icon: BarChart3 },
  fichas: { module: "fichas", title: "Fichas", copy: "Documentación técnica.", icon: FileText },
  radar: { module: "radar", title: "Revisar Radar", copy: "Prioriza aperturas, cierres y enmiendas.", icon: Radar },
  seguimiento: { module: "seguimiento", title: "Abrir seguimiento", copy: "Consulta cambios del SLI y comentarios.", icon: ClipboardList },
  proveedores: { module: "proveedores", title: "Buscar proveedores", copy: "Encuentra candidatos para los renglones activos.", icon: PackageSearch },
  auditor_empresas: { module: "auditor_empresas", title: "Auditar proveedor", copy: "Valida identidad y riesgo comercial.", icon: ShieldCheck },
  historico: { module: "historico", title: "Consultar histórico", copy: "Busca productos y licitaciones anteriores.", icon: BarChart3 },
  workspaces: { module: "workspaces", title: "Espacios guardados", copy: "Recupera expedientes de trabajo.", icon: FolderOpen },
  logistica: { module: "logistica", title: "Calcular logística", copy: "Cotiza el tránsito doméstico en Estados Unidos.", icon: Truck },
  metricas: { module: "metricas", title: "Métricas", copy: "Actividad y consumo.", icon: BarChart3 },
  admin: { module: "admin", title: "Administración", copy: "Usuarios, APIs y sistema.", icon: ShieldCheck }
};

function dashboardDefinition(role: string) {
  if (role === "Supervisor") return { title: "Prioridades del equipo", copy: "Revisa oportunidades, cambios del SLI y procesos que requieren atención.", primary: "radar" as ModuleId };
  if (role === "Gerencia") return { title: "Resumen gerencial", copy: "Consulta oportunidades, consumo y rendimiento del equipo.", primary: "radar" as ModuleId };
  if (role === "Logistica") return { title: "Mesa logística", copy: "Cotiza transportes y consulta referencias guardadas por el equipo.", primary: "logistica" as ModuleId };
  if (role === "Admin") return { title: "Panel de administración", copy: "Usuarios, configuración del sistema y estado de las integraciones.", primary: "admin" as ModuleId };
  return { title: "Tu jornada de procura", copy: "Analiza el RFQ y continúa con costos, proveedores y seguimiento.", primary: "rfq" as ModuleId };
}

function generalValue(result: RfqAnalysisResponse | null, keys: string[], fallback: string) {
  const source = result?.condiciones_generales || {};
  for (const key of keys) {
    const value = String(source[key] ?? "").trim();
    if (value && !["nan", "none", "null"].includes(value.toLowerCase())) return value;
  }
  return fallback;
}

export function RoleHome({ user, onModuleChange }: { user: AuthUser; onModuleChange?: (moduleId: ModuleId) => void }) {
  const role = normalizeRole(user.role);
  const definition = dashboardDefinition(role);
  const allowed = useMemo(() => new Set(getAllowedModules(user).map((item) => item.id)), [user]);
  const [radarStats, setRadarStats] = useState({ total: 0, alertas: 0, seguimiento: 0, cierre72h: 0 });
  const [loading, setLoading] = useState(allowed.has("radar"));
  const [logisticsStats, setLogisticsStats] = useState({ calculations: 0, forwarders: 0, carrierReady: false });
  const [loadingLogistics, setLoadingLogistics] = useState(role === "Logistica");
  const [activeRfq, setActiveRfq] = useState<RfqAnalysisResponse | null>(null);
  const [analystStats, setAnalystStats] = useState({ tracking: 0, workspaces: 0 });
  const [loadingAnalyst, setLoadingAnalyst] = useState(role === "Analista");

  const [gerenciaStats, setGerenciaStats] = useState({ tokens: 0, costUsd: 0, activeUsers: 0, errors: 0 });
  const [loadingGerencia, setLoadingGerencia] = useState(role === "Gerencia");

  const [adminStats, setAdminStats] = useState({ totalUsers: 0, telegramOk: false, telegramConfigured: false });
  const [loadingAdmin, setLoadingAdmin] = useState(role === "Admin");

  useEffect(() => {
    let mounted = true;
    if (!allowed.has("radar")) {
      setLoading(false);
      return () => { mounted = false; };
    }
    setLoading(true);
    getRadarStats()
      .then((response) => {
        if (!mounted) return;
        setRadarStats({
          total: response.total ?? 0,
          alertas: response.alertas ?? 0,
          seguimiento: response.en_seguimiento ?? 0,
          cierre72h: response.cierre_72h ?? 0
        });
      })
      .catch(() => {
        if (mounted) setRadarStats({ total: 0, alertas: 0, seguimiento: 0, cierre72h: 0 });
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [allowed]);

  useEffect(() => {
    let mounted = true;
    if (role !== "Logistica") {
      setLoadingLogistics(false);
      return () => { mounted = false; };
    }
    setLoadingLogistics(true);
    Promise.all([getLogisticsCalculations(100), getLogisticsSettings(), getLogisticsCarriersStatus()])
      .then(([history, settings, carriers]) => {
        if (!mounted) return;
        setLogisticsStats({
          calculations: history.calculations?.length || 0,
          forwarders: (settings.forwarders || []).filter((item) => item.activo !== false).length,
          carrierReady: Boolean(carriers.carriers?.shipstation?.configured)
        });
      })
      .catch(() => {
        if (mounted) setLogisticsStats({ calculations: 0, forwarders: 0, carrierReady: false });
      })
      .finally(() => { if (mounted) setLoadingLogistics(false); });
    return () => { mounted = false; };
  }, [role]);

  useEffect(() => {
    let mounted = true;
    if (role !== "Analista") {
      setLoadingAnalyst(false);
      return () => { mounted = false; };
    }

    setActiveRfq(loadLastRfq(user.username));
    setLoadingAnalyst(true);
    Promise.allSettled([
      getSeguimientos({ username: user.username, role }),
      listWorkspaces(user.username, false)
    ]).then(([tracking, workspaces]) => {
      if (!mounted) return;
      setAnalystStats({
        tracking: tracking.status === "fulfilled" ? tracking.value.seguimientos?.length || 0 : 0,
        workspaces: workspaces.status === "fulfilled" ? workspaces.value.workspaces?.length || 0 : 0
      });
    }).finally(() => {
      if (mounted) setLoadingAnalyst(false);
    });

    return () => { mounted = false; };
  }, [role, user.role, user.username]);

  useEffect(() => {
    let mounted = true;
    if (role !== "Gerencia") { setLoadingGerencia(false); return () => { mounted = false; }; }
    setLoadingGerencia(true);
    getUsageMetrics({ days: 30 })
      .then((response) => {
        if (!mounted) return;
        const s = response.summary;
        setGerenciaStats({
          tokens: s?.tokens_total ?? 0,
          costUsd: s?.estimated_cost_usd ?? 0,
          activeUsers: s?.active_users ?? 0,
          errors: s?.errors ?? 0
        });
      })
      .catch(() => { if (mounted) setGerenciaStats({ tokens: 0, costUsd: 0, activeUsers: 0, errors: 0 }); })
      .finally(() => { if (mounted) setLoadingGerencia(false); });
    return () => { mounted = false; };
  }, [role]);

  useEffect(() => {
    let mounted = true;
    if (role !== "Admin") { setLoadingAdmin(false); return () => { mounted = false; }; }
    setLoadingAdmin(true);
    Promise.allSettled([getAdminUsers(), getTelegramNotificationStatus()])
      .then(([usersResult, telegramResult]) => {
        if (!mounted) return;
        setAdminStats({
          totalUsers: usersResult.status === "fulfilled" ? usersResult.value.users?.length || 0 : 0,
          telegramOk: telegramResult.status === "fulfilled" ? Boolean(telegramResult.value.telegram?.enabled && telegramResult.value.telegram?.configured) : false,
          telegramConfigured: telegramResult.status === "fulfilled" ? Boolean(telegramResult.value.telegram?.configured) : false
        });
      })
      .finally(() => { if (mounted) setLoadingAdmin(false); });
    return () => { mounted = false; };
  }, [role]);

  const primary = allowed.has(definition.primary) ? actions[definition.primary] : actions[[...allowed][0] as ModuleId];
  const PrimaryIcon = primary?.icon;

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow={role}
          title={definition.title}
          copy={definition.copy}
          actions={role !== "Analista" && primary && PrimaryIcon ? (
            <Button variant="primary" size="lg" onClick={() => onModuleChange?.(primary.module)}>
              <PrimaryIcon className="h-4 w-4" />
              {primary.title}
            </Button>
          ) : null}
        />
      </ModuleSection>

      {allowed.has("radar") ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <StatCard loading={loading} label="Licitaciones abiertas" value={radarStats.total} hint={`${radarStats.cierre72h} cierran en 72 horas`} icon={Radar} />
          <StatCard loading={loading} label="En seguimiento" value={radarStats.seguimiento} hint="Procesos activos del equipo" icon={ClipboardList} />
          <StatCard loading={loading} label="Cambios detectados" value={radarStats.alertas} hint="Enmiendas o revisiones" icon={AlertTriangle} />
        </section>
      ) : null}

      {role === "Logistica" ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <StatCard loading={loadingLogistics} label="Cotizaciones guardadas" value={logisticsStats.calculations} hint="Referencias disponibles" icon={Truck} />
          <StatCard loading={loadingLogistics} label="Forwarders activos" value={logisticsStats.forwarders} hint="Destinos compartidos" icon={FolderOpen} />
          <StatCard loading={loadingLogistics} label="Transportista" value={logisticsStats.carrierReady ? "Conectado" : "Pendiente"} hint="Estado de tarifas en vivo" icon={ShieldCheck} />
        </section>
      ) : null}

      {role === "Gerencia" ? (
        <section className="grid gap-3 sm:grid-cols-4">
          <StatCard loading={loadingGerencia} label="Usuarios activos" value={gerenciaStats.activeUsers} hint="Últimos 30 días" icon={Users} />
          <StatCard loading={loadingGerencia} label="Tokens consumidos" value={gerenciaStats.tokens > 1000 ? `${(gerenciaStats.tokens / 1000).toFixed(0)}K` : String(gerenciaStats.tokens)} hint="Uso acumulado del equipo" icon={Gauge} />
          <StatCard loading={loadingGerencia} label="Costo estimado" value={gerenciaStats.costUsd > 0 ? `$${gerenciaStats.costUsd.toFixed(2)}` : "$0.00"} hint="Inversión en IA (30 días)" icon={DollarSign} />
          <StatCard loading={loadingGerencia} label="Errores recientes" value={gerenciaStats.errors} hint={gerenciaStats.errors === 0 ? "Sin incidentes" : "Revisar en Métricas"} icon={AlertTriangle} />
        </section>
      ) : null}

      {role === "Admin" ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <StatCard loading={loadingAdmin} label="Usuarios registrados" value={adminStats.totalUsers} hint="Cuentas en el sistema" icon={Users} />
          <StatCard loading={loadingAdmin} label="Telegram" value={adminStats.telegramOk ? "Activo" : adminStats.telegramConfigured ? "Configurado" : "Sin configurar"} hint={adminStats.telegramOk ? "Alertas habilitadas" : "Revisar configuración"} icon={Radar} />
          <StatCard loading={loadingAdmin} label="Sistema" value="En línea" hint="Estado general" icon={Settings} />
        </section>
      ) : null}

      {role === "Analista" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="RFQ actual"
              value={activeRfq?.items?.length || 0}
              hint={activeRfq ? `${generalValue(activeRfq, ["numero_licitacion", "numero_licitación", "licitacion", "n_licitacion"], "Sin número")} · renglones detectados` : "No hay un análisis activo"}
              icon={FileText}
            />
            <StatCard loading={loadingAnalyst} label="Mis seguimientos" value={analystStats.tracking} hint="Procesos conectados al SLI" icon={ClipboardList} />
            <StatCard loading={loadingAnalyst} label="Expedientes guardados" value={analystStats.workspaces} hint="Análisis disponibles para recuperar" icon={FolderOpen} />
          </section>

          <ModuleSection className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <h2 className="text-base font-semibold text-ink">{activeRfq ? "Continúa con el RFQ actual" : "Comienza un análisis RFQ"}</h2>
                <p className="mt-1 text-sm text-muted">{activeRfq ? "El análisis permanece disponible durante tu sesión." : "Carga el pliego para habilitar costos, proveedores y correo."}</p>
              </div>
              <StatusBadge tone={activeRfq ? "ok" : "neutral"}>{activeRfq ? "Análisis disponible" : "Sin RFQ activo"}</StatusBadge>
            </div>

            {activeRfq ? (
              <div className="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">Licitación</div>
                  <div className="mt-1 break-words text-lg font-semibold text-ink">{generalValue(activeRfq, ["numero_licitacion", "numero_licitación", "licitacion", "n_licitacion"], "Sin número identificado")}</div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{generalValue(activeRfq, ["objeto", "objeto_licitacion", "descripcion_general"], `${activeRfq.items?.length || 0} renglones listos para continuar.`)}</p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button type="button" variant="primary" onClick={() => onModuleChange?.("rfq")}><FileText className="h-4 w-4" />Abrir RFQ</Button>
                  <Button type="button" variant="secondary" onClick={() => onModuleChange?.("costos")}><BarChart3 className="h-4 w-4" />Costos</Button>
                  <Button type="button" variant="secondary" onClick={() => onModuleChange?.("proveedores")}><PackageSearch className="h-4 w-4" />Proveedores</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-brand"><FileText className="h-5 w-5" /></div>
                  <div><div className="text-sm font-semibold text-ink">Primer paso: analiza el pliego</div><p className="mt-1 text-sm leading-6 text-muted">Después podrás comparar precios, buscar proveedores y preparar la solicitud de cotización.</p></div>
                </div>
                <Button type="button" variant="primary" onClick={() => onModuleChange?.("rfq")} className="shrink-0">Analizar RFQ<ArrowRight className="h-4 w-4" /></Button>
              </div>
            )}
          </ModuleSection>
        </>
      ) : null}

      {allowed.has("radar") && !loading && (radarStats.alertas > 0 || radarStats.cierre72h > 0) ? (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Requiere atención:</strong> {radarStats.alertas} cambio(s) detectado(s) y {radarStats.cierre72h} cierre(s) dentro de 72 horas.</span>
        </div>
      ) : null}

    </div>
  );
}
