"use client";

import { AlertTriangle, BarChart3, ClipboardList, FileText, FolderOpen, Mail, PackageSearch, Radar, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { getAllowedModules, type ModuleId } from "@/lib/navigation";
import { getRadarStats } from "@/lib/radar";
import { getLogisticsCalculations, getLogisticsCarriersStatus, getLogisticsSettings } from "@/lib/logistics";

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
  rfq_email: { module: "rfq_email", title: "Preparar correo", copy: "Genera la solicitud de cotización.", icon: Mail },
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
  if (role === "Gerencia") return { title: "Resumen gerencial", copy: "Consulta oportunidades, actividad y referencias para decidir con rapidez.", primary: "radar" as ModuleId };
  if (role === "Logistica") return { title: "Mesa logística", copy: "Cotiza transportes y consulta referencias guardadas por el equipo.", primary: "logistica" as ModuleId };
  return { title: "Tu jornada de procura", copy: "Analiza el RFQ y continúa con costos, proveedores y seguimiento.", primary: "rfq" as ModuleId };
}

export function RoleHome({ user, onModuleChange }: { user: AuthUser; onModuleChange?: (moduleId: ModuleId) => void }) {
  const role = normalizeRole(user.role);
  const definition = dashboardDefinition(role);
  const allowed = useMemo(() => new Set(getAllowedModules(user).map((item) => item.id)), [user]);
  const [radarStats, setRadarStats] = useState({ total: 0, alertas: 0, seguimiento: 0, cierre72h: 0 });
  const [loading, setLoading] = useState(allowed.has("radar"));
  const [logisticsStats, setLogisticsStats] = useState({ calculations: 0, forwarders: 0, carrierReady: false });
  const [loadingLogistics, setLoadingLogistics] = useState(role === "Logistica");

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

  const primary = allowed.has(definition.primary) ? actions[definition.primary] : actions[[...allowed][0] as ModuleId];
  const PrimaryIcon = primary?.icon;

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow={role}
          title={definition.title}
          copy={definition.copy}
          actions={primary && PrimaryIcon ? (
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

      {allowed.has("radar") && !loading && (radarStats.alertas > 0 || radarStats.cierre72h > 0) ? (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Requiere atención:</strong> {radarStats.alertas} cambio(s) detectado(s) y {radarStats.cierre72h} cierre(s) dentro de 72 horas.</span>
        </div>
      ) : null}

    </div>
  );
}
