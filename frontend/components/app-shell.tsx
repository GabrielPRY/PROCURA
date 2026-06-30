"use client";

import { CheckCircle2, LogOut, Menu, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { cn } from "@/lib/ui/cn";
import { getAllowedModules, getModuleLabel, type ModuleId } from "@/lib/navigation";
import { cleanValue, loadLastRfq } from "@/lib/rfq";

function roleDescription(role: string) {
  if (role === "Admin") return "Usuarios, roles, llaves y salud del sistema.";
  if (role === "Gerencia") return "Vista gerencial, costos, consumo y decisiones.";
  if (role === "Supervisor") return "Radar SLI, seguimiento y flujo del analista.";
  if (role === "Logistica") return "Costos logisticos e historico operacional.";
  return "RFQ, proveedores, historico y evaluacion tecnica.";
}

function sectionLabel(moduleId: ModuleId) {
  if (["dashboard", "rfq", "evaluacion", "rfq_email"].includes(moduleId)) return "Flujo RFQ";
  if (["proveedores", "auditor_empresas"].includes(moduleId)) return "Proveedores";
  if (["costos", "historico", "workspaces", "logistica", "fichas"].includes(moduleId)) return "Datos y costos";
  if (["radar", "seguimiento"].includes(moduleId)) return "Supervision";
  if (["metricas", "admin"].includes(moduleId)) return "Sistema";
  return "Modulos";
}

export function AppShell({
  children,
  user,
  activeModule,
  onModuleChange,
  onLogout
}: {
  children: ReactNode;
  user: AuthUser;
  activeModule: ModuleId;
  onModuleChange: (moduleId: ModuleId) => void;
  onLogout: () => void;
}) {
  const role = normalizeRole(user.role);
  const visibleItems = getAllowedModules(user);
  const activeItem = visibleItems.find((item) => item.id === activeModule);
  const groupedItems = visibleItems.reduce<Record<string, typeof visibleItems>>((groups, item) => {
    const label = sectionLabel(item.id);
    groups[label] = groups[label] || [];
    groups[label].push(item);
    return groups;
  }, {});
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [activeRfqLabel, setActiveRfqLabel] = useState("");
  const shellTitle = role === "Admin" ? "Admin Console" : "Sourcing Console";
  const shellEyebrow = role === "Admin" ? "Procura AI Control" : "Procura AI";
  const environmentLabel = role === "Admin" ? "Consola administrativa" : "Beta interna";

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("procura_theme");
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {
      setTheme("light");
    }
  }, []);

  useEffect(() => {
    if (role === "Admin") {
      setActiveRfqLabel("");
      return;
    }
    try {
      const saved = loadLastRfq(user.username);
      if (!saved) {
        setActiveRfqLabel("");
        return;
      }
      const cg = (saved.condiciones_generales || {}) as Record<string, unknown>;
      const number = cleanValue(cg.numero_licitacion || cg.licitacion || cg.rfq_id, "RFQ sin numero");
      const count = saved.items?.length || 0;
      setActiveRfqLabel(`${number} | ${count} renglon(es)`);
    } catch {
      setActiveRfqLabel("");
    }
  }, [activeModule, role, user.username]);
  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem("procura_theme", next);
      } catch {
        // Theme still changes for this session.
      }
      return next;
    });
  }

  return (
    <div className={cn("app-shell-root", theme === "dark" && "dark")}>
      <aside className="app-sidebar fixed inset-y-0 left-0 hidden w-[17rem] flex-col border-r border-line bg-slate-50 lg:flex">
        <div className="shrink-0 border-b border-line bg-white px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-sm font-black text-white shadow-sm">
                  PA
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold uppercase tracking-wide text-brand">{shellEyebrow}</div>
                  <div className="mt-0.5 truncate text-lg font-semibold text-slate-950">{shellTitle}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge tone="info">{role}</StatusBadge>
                <StatusBadge tone="ok">Beta</StatusBadge>
              </div>
            </div>
            <Button type="button" onClick={toggleTheme} variant="secondary" size="icon" title={theme === "dark" ? "Modo claro" : "Modo oscuro"}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <nav className="app-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {Object.entries(groupedItems).map(([group, items]) => (
            <div key={group}>
              <div className="mb-1.5 px-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{group}</div>
              <div className="space-y-1">
                {items.map((item) => {
                  const active = item.id === activeModule;
                  return (
                    <button
                      key={item.label}
                      onClick={() => onModuleChange(item.id)}
                      title={`${item.label}: ${item.description}`}
                      className={cn(
                        "app-nav-item group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                        active
                          ? "app-nav-item-active border-blue-200 bg-blue-50 text-brand shadow-sm"
                          : "border-transparent text-slate-700 hover:border-blue-100 hover:bg-white hover:text-slate-950"
                      )}
                    >
                      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", active ? "bg-white text-brand" : "bg-slate-100 text-slate-500 group-hover:text-brand")}>
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{item.label}</span>
                        <span className="app-nav-desc mt-0.5 text-[11px] text-slate-500">{item.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-line bg-white p-3">
          <div className="rounded-xl border border-line bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-950">{user.username}</div>
                <div className="mt-0.5 truncate text-xs font-medium text-muted">{role}</div>
              </div>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                {String(user.username || "U").slice(0, 1).toUpperCase()}
              </span>
            </div>
            <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted">{roleDescription(role)}</div>
          </div>
          <Button onClick={onLogout} variant="secondary" className="mt-2 w-full">
            <LogOut className="h-4 w-4" />
            Cerrar sesion
          </Button>
        </div>
      </aside>

      <main className="app-content lg:pl-[17rem]">
        <header className="app-topbar sticky top-0 z-10 border-b border-line bg-white/90 px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{environmentLabel}</div>
              <h1 className="mt-0.5 truncate text-xl font-semibold text-slate-950">{getModuleLabel(activeModule)}</h1>
              {activeItem?.description ? <p className="mt-0.5 hidden truncate text-xs text-muted md:block">{activeItem.description}</p> : null}
              {activeRfqLabel ? <div className="mt-2 w-fit max-w-full truncate rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand">RFQ activo: {activeRfqLabel}</div> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <Button type="button" onClick={toggleTheme} variant="secondary" className="lg:hidden">
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                Tema
              </Button>
              <div className="hidden max-w-52 truncate rounded-lg border border-line bg-white px-3 py-2 text-sm text-slate-700 sm:block">
                {user.username} | {role}
              </div>
              <StatusBadge tone="ok" className="hidden sm:inline-flex">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sistema
              </StatusBadge>
            </div>
          </div>
        </header>

        <div className="border-b border-line bg-white px-4 py-3 lg:hidden">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <Menu className="h-3.5 w-3.5" />
            Modulos
          </div>
          <div className="app-scrollbar flex gap-2 overflow-x-auto pb-1">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onModuleChange(item.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold",
                  item.id === activeModule ? "border-blue-200 bg-blue-50 text-brand" : "border-line bg-white text-slate-700"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="app-page-frame mx-auto w-full max-w-[1500px] min-w-0 p-4 sm:p-5 xl:p-6">{children}</div>
      </main>
    </div>
  );
}


