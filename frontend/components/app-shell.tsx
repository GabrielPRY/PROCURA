"use client";

import { ChevronDown, LayoutGrid, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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

const compactNavLabels: Partial<Record<ModuleId, string>> = {
  costos: "Costos",
  radar: "Radar",
  workspaces: "Espacios",
  auditor_empresas: "Auditor IA"
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
  const primaryItems = visibleItems
    .filter((item) => preferred.includes(item.id))
    .sort((left, right) => preferred.indexOf(left.id) - preferred.indexOf(right.id));
  const moreItems = visibleItems.filter((item) => !preferred.includes(item.id));
  const activeInMore = moreItems.some((item) => item.id === activeModule);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!moreOpen) return;
    function closeMenu(event: MouseEvent) {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreOpen(false);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

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
    const visibleLabel = mobile ? item.label : compactNavLabels[item.id] || item.label;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onModuleChange(item.id)}
        title={item.description}
        aria-current={active ? "page" : undefined}
        className={cn(
          "app-top-nav-button min-w-0 items-center gap-2 border text-sm font-semibold",
          mobile ? "flex min-h-14 w-full justify-start px-3 py-2.5 text-left" : "inline-flex h-10 justify-center px-3",
          active && "app-top-nav-button-active"
        )}
      >
        <span className="app-nav-icon grid h-7 w-7 shrink-0 place-items-center rounded-md"><Icon className="h-4 w-4" /></span>
        <span className="min-w-0">
          <span className="block truncate">{visibleLabel}</span>
          {mobile ? <span className="mt-0.5 block truncate text-xs font-normal text-muted">{item.description}</span> : null}
        </span>
      </button>
    );
  }

  return (
    <div className={cn("app-shell-root min-h-screen", theme === "dark" && "dark")}>
      <header className="app-header sticky top-0 z-40 border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-[1680px] items-center gap-4 px-4 sm:px-5 xl:px-7">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-xs font-black text-white">PA</div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-bold uppercase text-brand">Procura AI</div>
              <div className="hidden truncate text-base font-semibold text-ink sm:block">{productName(role)}</div>
            </div>
          </div>

          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 xl:flex" aria-label="Navegación principal">
            <div className="flex min-w-0 items-center justify-center gap-1">
              {primaryItems.map((item) => navButton(item))}
            </div>
            {moreItems.length ? (
              <div ref={moreMenuRef} className="relative ml-1 shrink-0 border-l border-line pl-2">
                <button
                  type="button"
                  className={cn("app-top-nav-button app-nav-more-current inline-flex h-10 max-w-48 items-center gap-2 border px-3 text-sm font-semibold", activeInMore && "app-top-nav-button-active")}
                  onClick={() => setMoreOpen((current) => !current)}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  aria-current={activeInMore ? "page" : undefined}
                >
                  <LayoutGrid className="h-4 w-4" />
                  <span className="truncate">Módulos</span>
                  <span className="app-nav-count rounded-full px-1.5 py-0.5 text-[10px] font-bold">{moreItems.length}</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", moreOpen && "rotate-180")} />
                </button>
                {moreOpen ? (
                  <div className="app-nav-menu absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(42rem,calc(100vw-2rem))] border border-line p-3 shadow-lg" role="menu">
                    <div className="flex items-center justify-between gap-3 px-2 pb-3 pt-1">
                      <div><div className="text-sm font-semibold text-ink">Herramientas adicionales</div><div className="mt-0.5 text-xs text-muted">Funciones que no aparecen en la barra principal</div></div>
                      <span className="app-menu-count rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{moreItems.length} disponibles</span>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {moreItems.map((item) => (
                        <button key={item.id} type="button" role="menuitem" aria-current={item.id === activeModule ? "page" : undefined} onClick={() => { setMoreOpen(false); onModuleChange(item.id); }} className={cn("app-menu-item flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left", item.id === activeModule && "app-menu-item-active")}>
                          <span className="app-nav-icon grid h-8 w-8 shrink-0 place-items-center rounded-md"><item.icon className="h-4 w-4" /></span>
                          <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{item.label}</span><span className="mt-0.5 block line-clamp-1 text-xs leading-5 text-muted">{item.description}</span></span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span className="app-user-name hidden max-w-40 truncate text-sm font-semibold text-ink sm:block">{user.username}</span>
            <Button type="button" onClick={toggleTheme} variant="ghost" size="icon" title={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"} aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button type="button" onClick={() => setMobileOpen((current) => !current)} variant="secondary" size="icon" className="xl:hidden" title={mobileOpen ? "Cerrar navegación" : "Abrir navegación"} aria-label={mobileOpen ? "Cerrar navegación" : "Abrir navegación"} aria-expanded={mobileOpen}>
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
            <Button onClick={onLogout} variant="ghost" size="icon" title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {mobileOpen ? (
          <nav className="app-mobile-nav border-t border-line p-3 xl:hidden" aria-label="Navegación móvil">
            <div className="flex items-center justify-between gap-3 px-1 pb-3">
              <div><div className="text-sm font-semibold text-ink">Navegación</div><div className="mt-0.5 text-xs text-muted">{role}</div></div>
              <span className="rounded-full border border-line bg-slate-50 px-2.5 py-1 text-xs font-semibold text-muted">{visibleItems.length} módulos</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {primaryItems.map((item) => navButton(item, true))}
            </div>
            {moreItems.length ? <>
              <div className="mb-2 mt-4 border-t border-line pt-3 text-[11px] font-bold uppercase text-muted">Más herramientas</div>
              <div className="grid gap-2 sm:grid-cols-2">{moreItems.map((item) => navButton(item, true))}</div>
            </> : null}
          </nav>
        ) : null}
      </header>

      <main className="app-content mx-auto w-full max-w-[1680px] min-w-0 px-4 py-4 sm:px-5 xl:px-7 xl:py-5">
        <div key={activeModule} className="app-module-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
