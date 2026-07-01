"use client";

import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  LockKeyhole,
  Moon,
  Radar,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { login, saveSession, type AuthUser } from "@/lib/auth";

type LoginPanelProps = {
  onLogin: (user: AuthUser) => void;
};

const roleCards = [
  ["Analista", "RFQ, costos, historico y proveedores."],
  ["Supervisor", "Radar SLI, seguimiento y flujo analista."],
  ["Logistica", "Calculos, forwarders e historico."],
  ["Gerencia", "Metricas, consumo y decisiones."]
];

const systemSignals = [
  ["Backend", "FastAPI operativo", Activity],
  ["Datos", "Supabase persistente", Database],
  ["Beta", "Acceso por rol", ShieldCheck]
] as const;

const flowSteps = ["Analizar RFQ", "Comparar costos", "Buscar proveedores", "Dar seguimiento"];

export function LoginPanel({ onLogin }: LoginPanelProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Ingresa usuario y contrasena.");
      return;
    }

    setLoading(true);
    try {
      const user = await login(username.trim(), password);
      saveSession(user);
      onLogin(user);
    } catch {
      setError("Credenciales incorrectas o API no disponible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={`min-h-screen bg-slate-100 text-ink ${theme === "dark" ? "dark" : ""}`}>
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <section className="flex min-w-0 items-center justify-center bg-white px-5 py-8 sm:px-8 lg:px-10">
          <div className="w-full max-w-[27rem]">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-sm font-black text-white shadow-sm">
                  PA
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-black uppercase tracking-[0.14em] text-brand">Procura AI</div>
                  <div className="mt-0.5 truncate text-xl font-semibold tracking-tight text-slate-950">Acceso seguro</div>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-slate-50 text-slate-700 transition hover:bg-white"
                title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>

            <div className="rounded-2xl border border-line bg-panel p-5 shadow-sm sm:p-6">
              <div className="mb-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Beta interna por rol
                </div>
                <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">Ingresar al sistema</h1>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Accede con tu usuario corporativo. La sesion se conserva al refrescar la pagina.
                </p>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Usuario</span>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="h-12 w-full rounded-xl border border-line bg-white pl-10 pr-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-blue-100"
                      placeholder="Ej: Gabrielrrp"
                      autoComplete="username"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Contrasena</span>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 w-full rounded-xl border border-line bg-white pl-10 pr-12 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-blue-100"
                      placeholder="Tu contrasena"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                      title={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>

                {error ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                    {error}
                  </div>
                ) : null}

                <button
                  disabled={loading}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Validando acceso..." : "Entrar a Procura AI"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {systemSignals.map(([label, copy, Icon]) => (
                  <div key={label} className="min-w-0 rounded-xl border border-line bg-slate-50 p-3">
                    <Icon className="h-4 w-4 text-emerald-600" />
                    <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
                    <div className="mt-0.5 text-xs font-semibold leading-5 text-slate-900">{copy}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Preparado para demo operativa
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">
                RFQ, costos, proveedores, logistica y seguimiento en un flujo unico por usuario.
              </p>
            </div>
          </div>
        </section>

        <section className="relative hidden min-w-0 overflow-hidden border-l border-line bg-slate-950 px-8 py-8 text-white lg:block xl:px-14">
          <div className="absolute inset-0 opacity-70 [background:radial-gradient(circle_at_25%_15%,rgba(37,99,235,0.35),transparent_28rem),radial-gradient(circle_at_85%_65%,rgba(16,185,129,0.16),transparent_22rem)]" />
          <div className="relative flex min-h-full flex-col justify-between">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-brand">
                  <Radar className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-blue-200">Proyelec Sourcing</div>
                  <div className="truncate text-lg font-semibold">Procurement OS</div>
                </div>
              </div>
              <div className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">Beta</div>
            </div>

            <div className="my-12 max-w-4xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-blue-100">
                <Sparkles className="h-4 w-4" />
                Consola interna de licitaciones ACP
              </div>
              <h2 className="max-w-3xl text-4xl font-semibold tracking-tight xl:text-5xl">
                Decide, cotiza y da seguimiento desde un solo lugar.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
                Una experiencia por rol para analizar RFQ, revisar costos, buscar proveedores reales, preparar correos y controlar el seguimiento del SLI.
              </p>

              <div className="mt-8 grid gap-3 xl:grid-cols-4">
                {flowSteps.map((step, index) => (
                  <div key={step} className="rounded-2xl border border-white/12 bg-white/10 p-4 backdrop-blur">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-sm font-bold text-blue-100">{index + 1}</div>
                    <div className="mt-3 text-sm font-semibold text-white">{step}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {roleCards.map(([title, copy]) => (
                  <div key={title} className="min-w-0 rounded-2xl border border-white/12 bg-white/10 p-4 backdrop-blur">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <BarChart3 className="h-4 w-4 text-blue-200" />
                      {title}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-300">{copy}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 border-t border-white/10 pt-5 text-xs text-slate-400 sm:grid-cols-3">
              <div>
                <div className="font-semibold text-slate-200">Version</div>
                <div className="mt-1">Beta interna</div>
              </div>
              <div>
                <div className="font-semibold text-slate-200">Datos</div>
                <div className="mt-1">Supabase + FastAPI</div>
              </div>
              <div>
                <div className="font-semibold text-slate-200">Deploy</div>
                <div className="mt-1">Railway</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
