"use client";

import { ChevronDown, LogOut, Menu, Moon, MoreHorizontal, Sun, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { normalizeRole, type AuthUser } from "@/lib/auth";
import { cn } from "@/lib/ui/cn";
import { getAllowedModules, type ModuleId } from "@/lib/navigation";

const primaryByRole: Record<string, ModuleId[]> = {
  Analista: ["dashboard", "rfq", "costos", "proveedores", "seguimiento"],
  Supervisor: ["dashboard", "radar", "rfq", "costos", "seguimiento", "proveedores"],
  Gerencia: ["dashboard", "radar", "rfq", "costos", "seguimiento", "proveedores"],
  Logistica: ["dashboard", "logistica", "historico", "workspaces"],
  Admin: ["admin", "metricas"]
};

function productName(role: string) {
  if (role === "Admin") return "Administración";
  if (role === "Logistica") return "Logística";
  return "Sourcing Console";
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
  const preferred = primaryByRole[role] || [];
  const primaryItems = visibleItems.filter((item) => preferred.includes(item.id));
  const moreItems = visibleItems.filter((item) => !preferred.includes(item.id));
  const activeInMore = moreItems.some((item) => item.id === activeModule);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("procura_theme");
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {
      setTheme("light");
    }
  }, []);

  useEffect(() => {
    if (!visibleItems.some((item) => item.id === activeModule) && visibleItems[0]) {
      onModuleChange(visibleItems[0].id);
    }
  }, [activeModule, onModuleChange, visibleItems]);

  useEffect(() => {
    setMobileOpen(false);
    setMoreOpen(false);
  }, [activeModule]);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem("procura_theme", next);
      } catch {
        // The theme remains active for the current session.
      }
      return next;
    });
  }

  function navButton(item: (typeof visibleItems)[number], mobile = false) {
    const active = item.id === activeModule;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onModuleChange(item.id)}
        title={item.description}
        className={cn(
          "app-top-nav-button inline-flex min-w-0 items-center gap-2 border text-sm font-semibold",
          mobile ? "h-11 w-full justify-start px-3" : "h-10 justify-center px-3",
          active && "app-top-nav-button-active"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    );
  }

  return (
    <div className={cn("app-shell-root min-h-screen", theme === "dark" && "dark")}>
      <header className="app-header sticky top-0 z-40 border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-[1680px] items-center justify-between gap-4 px-4 sm:px-5 xl:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-xs font-black text-white">PA</div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-bold uppercase text-brand">Procura AI</div>
              <div className="truncate text-base font-semibold text-ink">{productName(role)}</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="hidden max-w-48 truncate px-2 text-sm font-semibold text-ink sm:block">{user.username}</span>
            <Button type="button" onClick={toggleTheme} variant="ghost" size="icon" title={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"} aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button type="button" onClick={() => setMobileOpen((current) => !current)} variant="secondary" size="icon" className="xl:hidden" title="Abrir navegación" aria-label="Abrir navegación" aria-expanded={mobileOpen}>
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
            <Button onClick={onLogout} variant="ghost" size="icon" title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="hidden border-t border-line xl:block">
          <nav className="mx-auto flex h-14 w-full max-w-[1680px] items-center gap-2 px-4 sm:px-5 xl:px-7" aria-label="Navegación principal">
            {primaryItems.map((item) => navButton(item))}
            {moreItems.length ? (
              <div className="relative ml-auto">
                <button
                  type="button"
                  className={cn("app-top-nav-button inline-flex h-10 items-center gap-2 border px-3 text-sm font-semibold", activeInMore && "app-top-nav-button-active")}
                  onClick={() => setMoreOpen((current) => !current)}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  Más
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", moreOpen && "rotate-180")} />
                </button>
                {moreOpen ? (
                  <div className="app-nav-menu absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 border border-line p-2 shadow-lg" role="menu">
                    {moreItems.map((item) => (
                      <button key={item.id} type="button" role="menuitem" onClick={() => onModuleChange(item.id)} className={cn("flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-blue-50 dark:hover:bg-slate-800", item.id === activeModule && "bg-blue-50 dark:bg-slate-800")}>
                        <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                        <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{item.label}</span><span className="mt-0.5 block text-xs leading-5 text-muted">{item.description}</span></span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </nav>
        </div>

        {mobileOpen ? (
          <nav className="grid gap-2 border-t border-line p-3 xl:hidden" aria-label="Navegación móvil">
            {visibleItems.map((item) => navButton(item, true))}
          </nav>
        ) : null}
      </header>

      <main className="app-content mx-auto w-full max-w-[1680px] min-w-0 px-4 py-5 sm:px-5 xl:px-7 xl:py-6">{children}</main>
    </div>
  );
}
