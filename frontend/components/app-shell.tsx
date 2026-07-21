"use client";

import { CheckCircle2, ChevronDown, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { cn } from "@/lib/ui/cn";
import { getAllowedModules, getModuleLabel, type ModuleId } from "@/lib/navigation";
import { cleanValue, loadLastRfq } from "@/lib/rfq";

function shellCopy(role: string) {
  if (role === "Admin") return { eyebrow: "Procura AI Control", title: "Admin Console", environment: "Consola administrativa" };
  if (role === "Logistica") return { eyebrow: "Procura AI", title: "Logistics Desk", environment: "Beta interna" };
  return { eyebrow: "Procura AI", title: "Sourcing Console", environment: "Beta interna" };
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
  const visibleItems = useMemo(() => getAllowedModules(user), [user]);
  const activeItem = visibleItems.find((item) => item.id === activeModule);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [navOpen, setNavOpen] = useState(true);
  const [activeRfqLabel, setActiveRfqLabel] = useState("");
  const shell = shellCopy(role);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("procura_theme");
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {
      setTheme("light");
    }
    try {
      const savedNav = window.localStorage.getItem("procura_nav_open");
      // Default open; only collapse if explicitly saved as closed
      if (savedNav === "false") setNavOpen(false);
    } catch {
      // keep default open
    }
  }, []);

  useEffect(() => {
    if (!visibleItems.some((item) => item.id === activeModule) && visibleItems[0]) {
      onModuleChange(visibleItems[0].id);
    }
  }, [activeModule, onModuleChange, visibleItems]);

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

  function toggleNav() {
    setNavOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("procura_nav_open", String(next));
      } catch {
        // Nav still toggles for this session.
      }
      return next;
    });
  }

  return (
    <div className={cn("app-shell-root min-h-screen", theme === "dark" && "dark")}>
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 shadow-sm backdrop-blur dark:bg-slate-950/95">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-4 px-4 py-3 sm:px-5 xl:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-sm font-black text-white shadow-sm">PA</div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-black uppercase tracking-[0.14em] text-brand">{shell.eyebrow}</div>
              <div className="truncate text-lg font-semibold text-slate-950 dark:text-white">{shell.title}</div>
            </div>
            <div className="hidden items-center gap-2 border-l border-line pl-3 lg:flex">
              <StatusBadge tone="info">{role}</StatusBadge>
              <StatusBadge tone="ok">Beta</StatusBadge>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="hidden max-w-[14rem] items-center rounded-full border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100 md:inline-flex">
              <span className="truncate">{user.username}</span>
            </div>
            <StatusBadge tone="ok" className="hidden sm:inline-flex">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sistema
            </StatusBadge>
            <Button type="button" onClick={toggleTheme} variant="secondary" size="icon" title={theme === "dark" ? "Modo claro" : "Modo oscuro"}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            
            <button
              type="button"
              onClick={toggleNav}
              aria-expanded={navOpen}
              aria-controls="app-main-nav"
              title={navOpen ? "Ocultar menu" : "Mostrar menu"}
              className="app-nav-toggle-btn inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-brand focus-visible:ring-2 focus-visible:ring-blue-300 active:scale-95 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {navOpen ? <X className="h-4 w-4 shrink-0" /> : <Menu className="h-4 w-4 shrink-0" />}
              <span className="hidden sm:inline">{navOpen ? "Menu" : "Menu"}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${
                  navOpen ? "rotate-180" : "rotate-0"
                }`}
              />
            </button>
            <Button onClick={onLogout} variant="secondary" className="app-desktop-logout hidden sm:inline-flex">
              <LogOut className="h-4 w-4" />
              Salir
            </Button>
          </div>
        </div>

        <div
          id="app-main-nav"
          className="mx-auto w-full max-w-[1800px] overflow-hidden px-4 sm:px-5 xl:px-7"
          style={{
            maxHeight: navOpen ? "32rem" : "0px",
            paddingBottom: navOpen ? "0.75rem" : "0px",
            transition: "max-height 0.28s cubic-bezier(0.4,0,0.2,1), padding-bottom 0.28s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          <div className="mb-2 flex min-w-0 flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-muted">{shell.environment}</div>
              <h1 className="mt-0.5 truncate text-xl font-semibold text-slate-950 dark:text-white">{getModuleLabel(activeModule)}</h1>
              {activeItem?.description ? <p className="mt-0.5 hidden truncate text-xs text-muted md:block">{activeItem.description}</p> : null}
            </div>
            {activeRfqLabel ? (
              <div className="max-w-full truncate rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand dark:border-blue-500/40 dark:bg-blue-500/10">
                RFQ activo: {activeRfqLabel}
              </div>
            ) : null}
          </div>

          <nav className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" aria-label="Navegacion principal">
            {visibleItems.map((item) => {
              const active = item.id === activeModule;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onModuleChange(item.id)}
                  title={`${item.label}: ${item.description}`}
                  className={cn(
                    "app-top-nav-button inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl border px-2.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-300 sm:justify-start lg:px-3 xl:text-sm",
                    active
                      ? "border-blue-200 bg-brand text-white shadow-sm shadow-blue-950/10"
                      : "border-line bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-brand dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1800px] min-w-0 px-4 py-5 sm:px-5 xl:px-7 xl:py-6">{children}</main>
    </div>
  );
}



