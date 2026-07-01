"use client";

import { AlertTriangle, BarChart3, CheckCircle2, ClipboardList, FileText, Loader2, PackageSearch, Settings, ShieldCheck, Truck } from "lucide-react";
import dynamic from "next/dynamic";
import { RoleHome } from "@/components/role-home";
import { canAccessModule, getModuleLabel, type ModuleId } from "@/lib/navigation";
import { normalizeRole, type AuthUser } from "@/lib/auth";

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
    <div className="app-card flex min-h-32 items-center gap-3 p-6 text-sm text-muted">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-brand">
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
      <div>
        <div className="font-semibold text-slate-900">Preparando módulo</div>
        <div className="mt-1">Cargando datos y componentes de la vista.</div>
      </div>
    </div>
  );
}

const AdminConsole = dynamic(() => import("@/components/admin-console").then((mod) => mod.AdminConsole), {
  ssr: false,
  loading: ModuleLoading
});
const AiCommandConsole = dynamic(() => import("@/components/ai-command-console").then((mod) => mod.AiCommandConsole), {
  ssr: false,
  loading: ModuleLoading
});
const CostAnalysisConsole = dynamic(() => import("@/components/cost-analysis-console").then((mod) => mod.CostAnalysisConsole), {
  ssr: false,
  loading: ModuleLoading
});
const CompanyAuditorConsole = dynamic(() => import("@/components/company-auditor-console").then((mod) => mod.CompanyAuditorConsole), {
  ssr: false,
  loading: ModuleLoading
});
const DatasheetsConsole = dynamic(() => import("@/components/datasheets-console").then((mod) => mod.DatasheetsConsole), {
  ssr: false,
  loading: ModuleLoading
});
const EvaluationConsole = dynamic(() => import("@/components/evaluation-console").then((mod) => mod.EvaluationConsole), {
  ssr: false,
  loading: ModuleLoading
});
const HistoricoConsole = dynamic(() => import("@/components/historico-console").then((mod) => mod.HistoricoConsole), {
  ssr: false,
  loading: ModuleLoading
});
const LogisticsConsole = dynamic(() => import("@/components/logistics-console").then((mod) => mod.LogisticsConsole), {
  ssr: false,
  loading: ModuleLoading
});
const MetricsConsole = dynamic(() => import("@/components/metrics-console").then((mod) => mod.MetricsConsole), {
  ssr: false,
  loading: ModuleLoading
});
const ProvidersConsole = dynamic(() => import("@/components/providers-console").then((mod) => mod.ProvidersConsole), {
  ssr: false,
  loading: ModuleLoading
});
const RadarConsole = dynamic(() => import("@/components/radar-console").then((mod) => mod.RadarConsole), {
  ssr: false,
  loading: ModuleLoading
});
const RfqConsole = dynamic(() => import("@/components/rfq-console").then((mod) => mod.RfqConsole), {
  ssr: false,
  loading: ModuleLoading
});
const RfqEmailConsole = dynamic(() => import("@/components/rfq-email-console").then((mod) => mod.RfqEmailConsole), {
  ssr: false,
  loading: ModuleLoading
});
const SeguimientoConsole = dynamic(() => import("@/components/seguimiento-console").then((mod) => mod.SeguimientoConsole), {
  ssr: false,
  loading: ModuleLoading
});
const WorkspacesConsole = dynamic(() => import("@/components/workspaces-console").then((mod) => mod.WorkspacesConsole), {
  ssr: false,
  loading: ModuleLoading
});

const moduleContent: Record<ModuleId, { eyebrow: string; title: string; subtitle: string; icon: typeof FileText; cards: ModuleCard[] }> = {
  dashboard: {
    eyebrow: "Inicio operativo",
    title: "Dashboard de trabajo",
    subtitle: "Resumen por rol para entrar rápido a lo importante sin mezclar herramientas.",
    icon: BarChart3,
    cards: [
      { title: "Trabajo pendiente", copy: "RFQ, proveedores y seguimiento se organizarán en una cola clara." },
      { title: "Alertas relevantes", copy: "Cambios de SLI, enmiendas y procesos por cerrar." },
      { title: "Actividad reciente", copy: "Últimos análisis, cotizaciones y licitaciones revisadas." }
    ]
  },
  rfq: {
    eyebrow: "Módulo RFQ",
    title: "Análisis técnico de licitaciones",
    subtitle: "Carga de pliegos, anexos, matriz de renglones, contacto ACP y correo de RFQ premium.",
    icon: FileText,
    cards: [
      { title: "Carga de pliego y anexos", copy: "Lectura multidocumento con regla de oro y control de versiones." },
      { title: "Matriz de renglones", copy: "Código ACP, descripción, marca, ficha/propuesta técnica y restricciones." },
      { title: "Correo dinámico", copy: "Borrador humano con lead time, Net 30 y adjuntos necesarios." }
    ]
  },
  evaluacion: {
    eyebrow: "Módulo Evaluación",
    title: "Validación de propuesta del proveedor",
    subtitle: "La propuesta del proveedor se cruza contra los requisitos técnicos, anexos y cambios del RFQ.",
    icon: ClipboardList,
    cards: [
      { title: "Cumple / parcial / no cumple", copy: "Marcado por requisito con evidencia del documento." },
      { title: "Anexos y enmiendas", copy: "Cambios posteriores al RFQ original se tratan como fuente prioritaria." },
      { title: "Exportable", copy: "Salida lista para compartir con supervisor o expediente." }
    ]
  },
  rfq_email: {
    eyebrow: "Correo RFQ",
    title: "Emisión profesional de RFQs",
    subtitle: "Genera correos editables con cumplimiento técnico, condiciones comerciales y adjuntos.",
    icon: FileText,
    cards: []
  },
  ai_command: {
    eyebrow: "Centro AI",
    title: "Asesor y Copilot",
    subtitle: "Asistencia contextual para negociación y preguntas del RFQ.",
    icon: FileText,
    cards: []
  },
  costos: {
    eyebrow: "Costos",
    title: "Análisis histórico",
    subtitle: "Comparación de precios históricos por renglón.",
    icon: BarChart3,
    cards: []
  },
  fichas: {
    eyebrow: "Fichas",
    title: "Fichas técnicas",
    subtitle: "Generación de fichas por renglón usando caché.",
    icon: FileText,
    cards: []
  },
  radar: {
    eyebrow: "Radar SLI",
    title: "Licitaciones abiertas del Canal",
    subtitle: "Módulo conectado a FastAPI para escanear, filtrar y monitorear oportunidades.",
    icon: AlertTriangle,
    cards: []
  },
  seguimiento: {
    eyebrow: "Seguimiento",
    title: "Pipeline de licitaciones",
    subtitle: "Control automático con SLI, comentarios y avance operativo de procesos activos.",
    icon: ClipboardList,
    cards: []
  },
  proveedores: {
    eyebrow: "Módulo Proveedores",
    title: "Sourcing global por renglón",
    subtitle: "La búsqueda se enfoca en 10 proveedores útiles, precio agresivo, cumplimiento técnico y riesgo controlado.",
    icon: PackageSearch,
    cards: [
      { title: "Búsqueda por renglón", copy: "Usa descripción técnica, marca, modelo, parte y equivalentes permitidos." },
      { title: "Prompt personalizado", copy: "Instrucciones extra para buscar proveedores poco obvios pero reales." },
      { title: "Riesgo comercial", copy: "Señales de empresa fantasma, reputación, web, dominio y contacto verificable." }
    ]
  },
  auditor_empresas: {
    eyebrow: "Auditor IA",
    title: "Auditoría de proveedores",
    subtitle: "Preauditoría comercial para validar si una empresa parece real, trazable y segura antes de cotizar o comprar.",
    icon: ShieldCheck,
    cards: [
      { title: "Empresa real", copy: "Web, contacto, dirección, presencia digital y coherencia comercial." },
      { title: "Alertas de fraude", copy: "Dominios dudosos, pagos riesgosos, datos inconsistentes y falta de trazabilidad." },
      { title: "Decision operativa", copy: "Avanzar, pedir validacion, avanzar con cautela o descartar." }
    ]
  },
  historico: {
    eyebrow: "Histórico",
    title: "Precios y participaciones anteriores",
    subtitle: "Consulta de historico corporativo desde Supabase.",
    icon: BarChart3,
    cards: []
  },
  workspaces: {
    eyebrow: "Workspaces",
    title: "Análisis guardados",
    subtitle: "Recupera matrices RFQ guardadas por usuario o equipo.",
    icon: FileText,
    cards: []
  },
  logistica: {
    eyebrow: "Módulo Logística",
    title: "Costos logísticos",
    subtitle: "Cálculos por paquete/bulto con peso, dimensiones, forwarder, ruta USA-Panamá e incoterms claros.",
    icon: Truck,
    cards: [
      { title: "Dimensiones y peso", copy: "Peso real vs volumetrico para costo mas confiable." },
      { title: "Forwarders", copy: "Localidades, modalidad, tiempos y tarifas administrables por logística." },
      { title: "Uso en RFQ", copy: "Adjuntar lead time y costo logístico al correo o análisis de margen." }
    ]
  },
  metricas: {
    eyebrow: "Módulo Métricas",
    title: "Consumo y salud del sistema",
    subtitle: "Panel gerencial para tokens, costos API, errores por módulo y actividad por usuario.",
    icon: BarChart3,
    cards: [
      { title: "Tokens y costos", copy: "Costo real por modelo, función, usuario y mes." },
      { title: "Errores", copy: "Fallos de API, scraper, login y guardado DB." },
      { title: "Uso simultaneo", copy: "Actividad por hora para medir carga y adopcion." }
    ]
  },
  admin: {
    eyebrow: "Módulo Admin",
    title: "Administración del sistema",
    subtitle: "Usuarios, roles, llaves, errores y configuración crítica del entorno.",
    icon: Settings,
    cards: [
      { title: "Usuarios y roles", copy: "Crear usuarios, cambiar rol y resetear contraseñas." },
      { title: "Llaves API", copy: "Validación de Gemini y futuros motores pagos." },
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
      <section className="app-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-brand">{content.eyebrow}</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{content.title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{content.subtitle}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <Icon className="h-4 w-4 text-brand" />
            Vista {role}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {content.cards.map((card) => (
          <div key={card.title} className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-brand">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="mt-4 text-base font-semibold">{card.title}</div>
            <p className="mt-2 text-sm leading-6 text-muted">{card.copy}</p>
          </div>
        ))}
      </section>

      <section className="app-empty">
        <div className="text-sm font-semibold text-slate-900">Siguiente paso de migración</div>
        <p className="mt-2 text-sm leading-6 text-muted">
          Esta pantalla ya está ordenada para conectar la función real desde FastAPI cuando toque migrarla.
        </p>
      </section>
    </div>
  );
}

export function ModuleRouter({ moduleId, user, onModuleChange }: ModuleRouterProps) {
  if (!canAccessModule(user, moduleId)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        Tu rol no tiene acceso al módulo {getModuleLabel(moduleId)}.
      </div>
    );
  }

  if (moduleId === "radar") return <RadarConsole user={user} />;
  if (moduleId === "rfq") return <RfqConsole user={user} onModuleChange={onModuleChange} />;
  if (moduleId === "evaluacion") return <EvaluationConsole user={user} />;
  if (moduleId === "rfq_email") return <RfqEmailConsole user={user} />;
  if (moduleId === "ai_command") return <AiCommandConsole user={user} />;
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
