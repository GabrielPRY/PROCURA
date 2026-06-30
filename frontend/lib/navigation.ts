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
  { id: "dashboard", label: "Dashboard", description: "Resumen operativo del rol activo.", icon: Gauge, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "rfq", label: "RFQ", description: "Carga, analisis y matriz tecnica.", icon: FileText, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "evaluacion", label: "Evaluacion", description: "Comparacion de propuesta del proveedor.", icon: ClipboardList, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "rfq_email", label: "Correo RFQ", description: "Emision profesional de solicitudes.", icon: Mail, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "costos", label: "Costos", description: "Analisis historico de precios.", icon: BarChart3, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "fichas", label: "Fichas", description: "Fichas tecnicas por renglon.", icon: FileText, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "radar", label: "Radar SLI", description: "Licitaciones abiertas, filtros y enmiendas.", icon: Radar, permissions: ["Supervisor", "Gerencia"] },
  { id: "seguimiento", label: "Seguimiento", description: "Estados SLI y comentarios de licitaciones.", icon: ClipboardList, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "proveedores", label: "Proveedores", description: "Sourcing global por renglon.", icon: PackageSearch, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "auditor_empresas", label: "Auditor IA", description: "Riesgo comercial de proveedores.", icon: ShieldCheck, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "historico", label: "Historico", description: "Precios y participaciones pasadas.", icon: Database, permissions: ["Analista", "Supervisor", "Gerencia", "Logistica"] },
  { id: "workspaces", label: "Workspaces", description: "Analisis RFQ guardados.", icon: FolderOpen, permissions: ["Analista", "Supervisor", "Gerencia"] },
  { id: "logistica", label: "Logistica", description: "Costos, paquetes, forwarders e incoterms.", icon: Truck, permissions: ["Analista", "Supervisor", "Gerencia", "Logistica"] },
  { id: "metricas", label: "Metricas", description: "Consumo, errores y actividad.", icon: BarChart3, permissions: ["Gerencia"] },
  { id: "admin", label: "Admin", description: "Usuarios, roles y configuracion.", icon: Settings, permissions: ["Admin"] }
];

export function getAllowedModules(user: AuthUser) {
  const role = normalizeRole(user.role);
  return navigationItems.filter((item) => item.permissions.includes(role));
}

export function canAccessModule(user: AuthUser, moduleId: ModuleId) {
  return getAllowedModules(user).some((item) => item.id === moduleId);
}

export function getDefaultModule(user: AuthUser): ModuleId {
  const role = normalizeRole(user.role);
  if (role === "Supervisor" || role === "Gerencia") return "radar";
  if (role === "Logistica") return "logistica";
  if (role === "Admin") return "admin";
  return "dashboard";
}

export function getModuleLabel(moduleId: ModuleId) {
  return navigationItems.find((item) => item.id === moduleId)?.label ?? "Procura AI";
}
