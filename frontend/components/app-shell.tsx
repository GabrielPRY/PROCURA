"use client";

import { CheckCircle2, LogOut, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { getAllowedModules, getModuleLabel, type ModuleId } from "@/lib/navigation";

function roleDescription(role: string) {
  if (role === "Admin") return "Usuarios, roles, llaves y salud del sistema.";
  if (role === "Gerencia") return "Vista gerencial, costos, consumo y decisiones.";
  if (role === "Supervisor") return "Radar SLI, seguimiento y flujo del analista.";
  if (role === "Logistica") return "Costos logisticos e historico operacional.";
  return "RFQ, proveedores, historico y evaluacion tecnica.";
}

function sectionLabel(moduleId: ModuleId) {
  if (["dashboard", "rfq", "evaluacion", "rfq_email", "ai_command"].includes(moduleId)) return "Trabajo diario";
  if (["proveedores", "auditor_empresas"].includes(moduleId)) return "Proveedores";
  if (["costos", "historico", "workspaces", "logistica"].includes(moduleId)) return "Datos y costos";
  if (["radar", "seguimiento"].includes(moduleId)) return "Supervision";
  if (["metricas", "admin"].includes(moduleId)) return "Administracion";
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
    <div className={`app-shell-root ${theme === "dark" ? "dark" : ""}`}>
      <aside className="app-sidebar app-sidebar-premium fixed inset-y-0 left-0 hidden w-[17rem] flex-col border-r lg:flex">
        <div className="shrink-0 border-b border-line px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="app-brand-mark grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-black shadow-sm">
                  PA
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold uppercase tracking-wide text-blue-200">{shellEyebrow}</div>
                  <div className="mt-0.5 truncate text-lg font-semibold text-white">{shellTitle}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-100">
                  {role}
                </span>
                <span className="inline-flex rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                  Beta
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-slate-100 transition hover:bg-white/15"
              title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <nav className="app-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {Object.entries(groupedItems).map(([group, items]) => (
            <div key={group}>
              <div className="mb-1.5 px-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{group}</div>
              <div className="space-y-1">
                {items.map((item) => {
                  const active = item.id === activeModule;
                  return (
                    <button
                      key={item.label}
                      onClick={() => onModuleChange(item.id)}
                      title={`${item.label}: ${item.description}`}
                      className={`app-nav-item group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                        active
                          ? "app-nav-item-active border-blue-300 bg-blue-50 text-brand shadow-sm"
                          : "border-transparent text-slate-700 hover:border-blue-200 hover:bg-blue-50/70"
                      }`}
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${
                        active ? "bg-white text-brand" : "bg-slate-100 text-slate-500 group-hover:text-brand"
                      }`}>
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{item.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-white/10 bg-slate-950/65 p-3 backdrop-blur">
          <div className="rounded-lg border border-white/10 bg-white/10 p-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{user.username}</div>
                <div className="mt-0.5 truncate text-xs font-medium text-blue-200">{role}</div>
              </div>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-500 text-xs font-bold text-white">
                {String(user.username || "U").slice(0, 1).toUpperCase()}
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-300">{roleDescription(role)}</div>
          </div>
          <button
            onClick={onLogout}
            className="app-btn app-btn-secondary mt-2 w-full border-white/10 bg-white/10 text-slate-100 hover:bg-white/15"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesion
          </button>
        </div>
      </aside>
      <main className="app-content lg:pl-[17rem]">
        <header className="app-topbar sticky top-0 z-10 border-b border-line px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{environmentLabel}</div>
              <h1 className="mt-0.5 truncate text-xl font-semibold">{getModuleLabel(activeModule)}</h1>
              {activeItem?.description ? <p className="mt-0.5 hidden truncate text-xs text-muted md:block">{activeItem.description}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:hidden"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                Tema
              </button>
              <div className="hidden max-w-52 truncate rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700 sm:block">
                {user.username} | {role}
              </div>
              <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700" title="Sistema disponible">
                <CheckCircle2 className="h-4 w-4" />
                Sistema
              </div>
            </div>
          </div>
        </header>
        <div className="border-b border-line bg-white px-4 py-3 lg:hidden">
          <div className="app-scrollbar flex gap-2 overflow-x-auto pb-1">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onModuleChange(item.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${
                  item.id === activeModule ? "border-blue-200 bg-blue-50 text-brand" : "border-line bg-white text-slate-700"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="app-page-frame mx-auto w-full max-w-[1600px] min-w-0 p-4 sm:p-5 xl:p-6">{children}</div>
      </main>
    </div>
  );
}
