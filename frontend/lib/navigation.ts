import { BarChart3, ClipboardList, Database, FileText, FolderOpen, Gauge, Mail, PackageSearch, Radar, Settings, ShieldCheck, Truck } from "lucide-react";
import { normalizeRole, type AuthUser } from "@/lib/auth";

export type ModuleId =
  | "dashboard"
  | "rfq"
  | "evaluacion"
  | "rfq_email"
  | "ai_command"
  | "costos"
  | "fichas"
  | "radar"
  | "seguimiento"
  | "proveedores"
  | "auditor_empresas"
  | "historico"
  | "workspaces"
  | "logistica"
  | "metricas"
  | "admin";

export type NavigationItem = {
  id: ModuleId;
  label: string;
  description: string;
  permissions: string[];
  icon: typeof Gauge;
};

export const navigationItems: NavigationItem[] = [
  { id: "dashboard", label: "Dashboard", description: "Resumen operativo del rol activo.", icon: Gauge, permissions: ["Analista", "Supervisor", "Gerencia", "Logistica"] },
  { id: "rfq", label: "RFQ", description: "Carga, análisis y matriz técnica.", icon: FileText, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "rfq_email", label: "Correo RFQ", description: "Emisión profesional de solicitudes.", icon: Mail, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "costos", label: "Comparativa de costos", description: "Precios históricos y referencias por renglón.", icon: BarChart3, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "radar", label: "Radar SLI", description: "Licitaciones abiertas, filtros y enmiendas.", icon: Radar, permissions: ["Supervisor", "Gerencia"] },
  { id: "seguimiento", label: "Seguimiento", description: "Estados SLI y comentarios de licitaciones.", icon: ClipboardList, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "proveedores", label: "Proveedores", description: "Sourcing global por renglón.", icon: PackageSearch, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "auditor_empresas", label: "Auditor IA", description: "Riesgo comercial de proveedores.", icon: ShieldCheck, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "historico", label: "Histórico", description: "Precios y participaciones pasadas.", icon: Database, permissions: ["Analista", "Supervisor", "Gerencia", "Logistica"] },
  { id: "workspaces", label: "Espacios guardados", description: "Expedientes y análisis RFQ guardados.", icon: FolderOpen, permissions: ["Analista", "Supervisor", "Gerencia", "Logistica"] },
  { id: "logistica", label: "Logística", description: "Comparación de transportistas dentro de Estados Unidos.", icon: Truck, permissions: ["Analista", "Supervisor", "Gerencia", "Logistica"] },
  { id: "metricas", label: "Métricas", description: "Consumo, errores y actividad.", icon: BarChart3, permissions: ["Gerencia", "Admin"] },
  { id: "admin", label: "Administración", description: "Usuarios, roles y configuración.", icon: Settings, permissions: ["Admin"] }
];

export function getAllowedModules(user: AuthUser) {
  const role = normalizeRole(user.role);
  const allowed = navigationItems.filter((item) => item.permissions.includes(role));
  const preferredOrder: Partial<Record<string, ModuleId[]>> = {
    Logistica: ["dashboard", "logistica", "historico", "workspaces"],
    Admin: ["admin", "metricas"]
  };
  const order = preferredOrder[role];
  if (!order) return allowed;
  return [...allowed].sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
}

export function canAccessModule(user: AuthUser, moduleId: ModuleId) {
  if (moduleId === "evaluacion") {
    return ["Analista", "Supervisor", "Gerencia"].includes(normalizeRole(user.role));
  }
  return getAllowedModules(user).some((item) => item.id === moduleId);
}

export function getDefaultModule(user: AuthUser): ModuleId {
  const role = normalizeRole(user.role);
  if (role === "Admin") return "admin";
  return "dashboard";
}

export function getModuleLabel(moduleId: ModuleId) {
  if (moduleId === "evaluacion") return "Evaluación técnica";
  return navigationItems.find((item) => item.id === moduleId)?.label ?? "Procura AI";
}

