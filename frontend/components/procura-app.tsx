"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LoginPanel } from "@/components/login-panel";
import { ModuleRouter } from "@/components/module-router";
import { clearSession, loadSession, type AuthUser } from "@/lib/auth";
import { canAccessModule, getDefaultModule, type ModuleId } from "@/lib/navigation";

const moduleSessionKey = (username: string) => `procura_frontend_module_${username}`;

export function ProcuraApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleId>("dashboard");
  const [mountedModules, setMountedModules] = useState<ModuleId[]>(["dashboard"]);
  const [hydrated, setHydrated] = useState(false);
  const [bootSlow, setBootSlow] = useState(false);

  useEffect(() => {
    const bootTimer = window.setTimeout(() => setBootSlow(true), 1200);
    try {
      const savedUser = loadSession();
      setUser(savedUser);
      if (savedUser) {
        let savedModule: ModuleId | null = null;
        try {
          savedModule = window.localStorage.getItem(moduleSessionKey(savedUser.username)) as ModuleId | null;
        } catch {
          savedModule = null;
        }
        const initialModule = savedModule && canAccessModule(savedUser, savedModule) ? savedModule : getDefaultModule(savedUser);
        setActiveModule(initialModule);
        setMountedModules([initialModule]);
      }
    } catch {
      clearSession();
      setUser(null);
      setActiveModule("dashboard");
      setMountedModules(["dashboard"]);
    } finally {
      window.clearTimeout(bootTimer);
      setHydrated(true);
    }
  }, []);

  function handleLogin(nextUser: AuthUser) {
    setUser(nextUser);
    const defaultModule = getDefaultModule(nextUser);
    setActiveModule(defaultModule);
    setMountedModules([defaultModule]);
    window.localStorage.setItem(moduleSessionKey(nextUser.username), defaultModule);
  }

  function handleModuleChange(moduleId: ModuleId) {
    if (!user || !canAccessModule(user, moduleId)) return;
    setActiveModule(moduleId);
    setMountedModules((current) => (current.includes(moduleId) ? current : [...current, moduleId]));
    window.localStorage.setItem(moduleSessionKey(user.username), moduleId);
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setActiveModule("dashboard");
    setMountedModules(["dashboard"]);
  }

  if (!hydrated) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 text-sm font-medium text-muted">
        <div className="grid gap-3 text-center">
          <div>Cargando Procura AI...</div>
          {bootSlow ? <div className="text-xs text-slate-500">Recuperando tu sesión...</div> : null}
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginPanel onLogin={handleLogin} />;
  }

  return (
    <AppShell user={user} activeModule={activeModule} onModuleChange={handleModuleChange} onLogout={handleLogout}>
      {mountedModules.map((moduleId) => (
        <section
          key={moduleId}
          aria-hidden={moduleId !== activeModule}
          className={moduleId === activeModule ? "block" : "hidden"}
        >
          <ModuleRouter moduleId={moduleId} user={user} active={moduleId === activeModule} onModuleChange={handleModuleChange} />
        </section>
      ))}
    </AppShell>
  );
}
