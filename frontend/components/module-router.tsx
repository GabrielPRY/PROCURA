"use client";

import { AlertTriangle, BarChart3, CheckCircle2, ClipboardList, FileText, Loader2, PackageSearch, Settings, ShieldCheck, Truck } from "lucide-react";
import dynamic from "next/dynamic";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { RoleHome } from "@/components/role-home";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { canAccessModule, getModuleLabel, type ModuleId } from "@/lib/navigation";

type ModuleRouterProps = {
  moduleId: ModuleId;
  user: AuthUser;
  onModuleChange?: (moduleId: ModuleId) => void;
};

type ModuleCard = {
  title: string;
  copy: string;
};

function ModuleLoading() {
  return (
    <ModuleSection className="flex min-h-32 items-center gap-3 text-sm text-muted">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-brand">
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
      <div>
        <div className="font-semibold text-slate-950">Preparando modulo</div>
        <div className="mt-1">Cargando datos y componentes de la vista.</div>
      </div>
    </ModuleSection>
  );
}

const AdminConsole = dynamic(() => import("@/components/admin-console").then((mod) => mod.AdminConsole), { ssr: false, loading: ModuleLoading });
const CostAnalysisConsole = dynamic(() => import("@/components/cost-analysis-console").then((mod) => mod.CostAnalysisConsole), { ssr: false, loading: ModuleLoading });
const CompanyAuditorConsole = dynamic(() => import("@/components/company-auditor-console").then((mod) => mod.CompanyAuditorConsole), { ssr: false, loading: ModuleLoading });
const DatasheetsConsole = dynamic(() => import("@/components/datasheets-console").then((mod) => mod.DatasheetsConsole), { ssr: false, loading: ModuleLoading });
const EvaluationConsole = dynamic(() => import("@/components/evaluation-console").then((mod) => mod.EvaluationConsole), { ssr: false, loading: ModuleLoading });
const HistoricoConsole = dynamic(() => import("@/components/historico-console").then((mod) => mod.HistoricoConsole), { ssr: false, loading: ModuleLoading });
const LogisticsConsole = dynamic(() => import("@/components/logistics-console").then((mod) => mod.LogisticsConsole), { ssr: false, loading: ModuleLoading });
const MetricsConsole = dynamic(() => import("@/components/metrics-console").then((mod) => mod.MetricsConsole), { ssr: false, loading: ModuleLoading });
const ProvidersConsole = dynamic(() => import("@/components/providers-console").then((mod) => mod.ProvidersConsole), { ssr: false, loading: ModuleLoading });
const RadarConsole = dynamic(() => import("@/components/radar-console").then((mod) => mod.RadarConsole), { ssr: false, loading: ModuleLoading });
const RfqConsole = dynamic(() => import("@/components/rfq-console").then((mod) => mod.RfqConsole), { ssr: false, loading: ModuleLoading });
const RfqEmailConsole = dynamic(() => import("@/components/rfq-email-console").then((mod) => mod.RfqEmailConsole), { ssr: false, loading: ModuleLoading });
const SeguimientoConsole = dynamic(() => import("@/components/seguimiento-console").then((mod) => mod.SeguimientoConsole), { ssr: false, loading: ModuleLoading });
const WorkspacesConsole = dynamic(() => import("@/components/workspaces-console").then((mod) => mod.WorkspacesConsole), { ssr: false, loading: ModuleLoading });

const moduleContent: Record<ModuleId, { eyebrow: string; subtitle: string; icon: typeof FileText; cards: ModuleCard[] }> = {
  dashboard: {
    eyebrow: "Inicio operativo",
    subtitle: "Resumen por rol para entrar rapido a lo importante sin mezclar herramientas.",
    icon: BarChart3,
    cards: []
  },
  rfq: {
    eyebrow: "Modulo RFQ",
    subtitle: "Carga de pliegos, anexos, matriz de renglones, contacto ACP y correo de RFQ premium.",
    icon: FileText,
    cards: [
      { title: "Carga de pliego y anexos", copy: "Lectura multidocumento con regla de oro y control de versiones." },
      { title: "Matriz de renglones", copy: "Codigo ACP, descripcion, marca, ficha/propuesta tecnica y restricciones." },
      { title: "Correo dinamico", copy: "Borrador humano con lead time, Net 30 y adjuntos necesarios." }
    ]
  },
  evaluacion: {
    eyebrow: "Modulo Evaluacion",
    subtitle: "La propuesta del proveedor se cruza contra los requisitos tecnicos, anexos y cambios del RFQ.",
    icon: ClipboardList,
    cards: [
      { title: "Cumple / parcial / no cumple", copy: "Marcado por requisito con evidencia del documento." },
      { title: "Anexos y enmiendas", copy: "Cambios posteriores al RFQ original se tratan como fuente prioritaria." },
      { title: "Exportable", copy: "Salida lista para compartir con supervisor o expediente." }
    ]
  },
  rfq_email: { eyebrow: "Correo RFQ", subtitle: "Genera correos editables con cumplimiento tecnico, condiciones comerciales y adjuntos.", icon: FileText, cards: [] },
  ai_command: { eyebrow: "Centro AI", subtitle: "Modulo pausado para evitar consumo innecesario de tokens.", icon: FileText, cards: [] },
  costos: { eyebrow: "Costos", subtitle: "Comparacion de precios historicos por renglon.", icon: BarChart3, cards: [] },
  fichas: { eyebrow: "Fichas", subtitle: "Generacion de fichas por renglon usando cache.", icon: FileText, cards: [] },
  radar: { eyebrow: "Radar SLI", subtitle: "Modulo conectado a FastAPI para escanear, filtrar y monitorear oportunidades.", icon: AlertTriangle, cards: [] },
  seguimiento: { eyebrow: "Seguimiento", subtitle: "Control automatico con SLI, comentarios y avance operativo de procesos activos.", icon: ClipboardList, cards: [] },
  proveedores: {
    eyebrow: "Modulo Proveedores",
    subtitle: "Sourcing global enfocado en precio agresivo, cumplimiento tecnico y riesgo controlado.",
    icon: PackageSearch,
    cards: [
      { title: "Busqueda por renglon", copy: "Usa descripcion tecnica, marca, modelo, parte y equivalentes permitidos." },
      { title: "Prompt personalizado", copy: "Instrucciones extra para buscar proveedores poco obvios pero reales." },
      { title: "Riesgo comercial", copy: "Senales de empresa fantasma, reputacion, web, dominio y contacto verificable." }
    ]
  },
  auditor_empresas: {
    eyebrow: "Auditor IA",
    subtitle: "Preauditoria comercial para validar si una empresa parece real, trazable y segura.",
    icon: ShieldCheck,
    cards: [
      { title: "Empresa real", copy: "Web, contacto, direccion, presencia digital y coherencia comercial." },
      { title: "Alertas de fraude", copy: "Dominios dudosos, pagos riesgosos, datos inconsistentes y falta de trazabilidad." },
      { title: "Decision operativa", copy: "Avanzar, pedir validacion, avanzar con cautela o descartar." }
    ]
  },
  historico: { eyebrow: "Historico", subtitle: "Consulta de historico corporativo desde Supabase.", icon: BarChart3, cards: [] },
  workspaces: { eyebrow: "Workspaces", subtitle: "Recupera matrices RFQ guardadas por usuario o equipo.", icon: FileText, cards: [] },
  logistica: {
    eyebrow: "Modulo Logistica",
    subtitle: "Comparación de tarifas desde el proveedor hasta el forwarder dentro de Estados Unidos.",
    icon: Truck,
    cards: [
      { title: "UPS", copy: "Tarifas de paqueteria y tiempos de entrega desde la cuenta corporativa." },
      { title: "Forwarders", copy: "Destinos compartidos y administrados por Logistica." }
    ]
  },
  metricas: {
    eyebrow: "Modulo Metricas",
    subtitle: "Panel gerencial para tokens, costos API, errores por modulo y actividad por usuario.",
    icon: BarChart3,
    cards: [
      { title: "Tokens y costos", copy: "Costo real por modelo, funcion, usuario y mes." },
      { title: "Errores", copy: "Fallos de API, scraper, login y guardado DB." },
      { title: "Uso simultaneo", copy: "Actividad por hora para medir carga y adopcion." }
    ]
  },
  admin: {
    eyebrow: "Modulo Admin",
    subtitle: "Usuarios, roles, llaves, errores y configuracion critica del entorno.",
    icon: Settings,
    cards: [
      { title: "Usuarios y roles", copy: "Crear usuarios, cambiar rol y resetear contrasenas." },
      { title: "Llaves API", copy: "Validacion de Gemini y futuros motores pagos." },
      { title: "Salud operativa", copy: "Errores, procesos automaticos y estado de servicios." }
    ]
  }
};

function ModulePlaceholder({ moduleId, user }: ModuleRouterProps) {
  const content = moduleContent[moduleId];
  const Icon = content.icon;
  const role = normalizeRole(user.role);

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow={content.eyebrow}
          copy={content.subtitle}
          actions={
            <StatusBadge tone="info">
              <Icon className="h-3.5 w-3.5" />
              Vista {role}
            </StatusBadge>
          }
        />
      </ModuleSection>

      {content.cards.length ? (
        <section className="grid gap-4 md:grid-cols-3">
          {content.cards.map((card) => (
            <ModuleSection key={card.title}>
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-brand">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="mt-4 text-base font-semibold text-slate-950">{card.title}</div>
              <p className="mt-2 text-sm leading-6 text-muted">{card.copy}</p>
            </ModuleSection>
          ))}
        </section>
      ) : null}

      <EmptyState
        title="Siguiente paso de migracion"
        copy="Esta pantalla ya esta ordenada para conectar la funcion real desde FastAPI cuando toque migrarla."
        icon={Icon}
      />
    </div>
  );
}

export function ModuleRouter({ moduleId, user, onModuleChange }: ModuleRouterProps) {
  if (!canAccessModule(user, moduleId)) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">Tu rol no tiene acceso al modulo {getModuleLabel(moduleId)}.</div>;
  }

  if (moduleId === "radar") return <RadarConsole user={user} />;
  if (moduleId === "rfq") return <RfqConsole user={user} onModuleChange={onModuleChange} />;
  if (moduleId === "evaluacion") return <EvaluationConsole user={user} />;
  if (moduleId === "rfq_email") return <RfqEmailConsole user={user} />;
  if (moduleId === "ai_command") return <ModulePlaceholder moduleId={moduleId} user={user} />;
  if (moduleId === "costos") return <CostAnalysisConsole user={user} />;
  if (moduleId === "fichas") return <DatasheetsConsole user={user} />;
  if (moduleId === "seguimiento") return <SeguimientoConsole user={user} />;
  if (moduleId === "proveedores") return <ProvidersConsole user={user} onModuleChange={onModuleChange} />;
  if (moduleId === "auditor_empresas") return <CompanyAuditorConsole user={user} />;
  if (moduleId === "historico") return <HistoricoConsole user={user} />;
  if (moduleId === "workspaces") return <WorkspacesConsole user={user} onOpenRfq={() => onModuleChange?.("rfq")} />;
  if (moduleId === "logistica") return <LogisticsConsole user={user} />;
  if (moduleId === "metricas") return <MetricsConsole user={user} />;
  if (moduleId === "admin") return <AdminConsole user={user} />;
  if (moduleId === "dashboard") return <RoleHome user={user} onModuleChange={onModuleChange} />;
  return <ModulePlaceholder moduleId={moduleId} user={user} />;
}



