"use client";

import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { login, saveSession, type AuthUser } from "@/lib/auth";

type LoginPanelProps = {
  onLogin: (user: AuthUser) => void;
};

export function LoginPanel({ onLogin }: LoginPanelProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Ingresa usuario y contraseña.");
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
    <main className="min-h-screen bg-[#f5f7fb] px-5 py-8 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center justify-center">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src="/proyelec_logo.png"
              alt="Proyelec International"
              className="h-16 w-auto object-contain"
            />
            <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-950">Procura AI</h1>
            <p className="mt-1 text-sm text-slate-500">Acceso interno</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Usuario</span>
              <div className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 transition hover:border-slate-300 focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-100">
                <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm font-medium text-slate-950 outline-none placeholder:text-slate-400"
                  placeholder="Usuario"
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Contraseña</span>
              <div className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 transition hover:border-slate-300 focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-100">
                <LockKeyhole className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm font-medium text-slate-950 outline-none placeholder:text-slate-400"
                  placeholder="Contraseña"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
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
              type="submit"
              className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Validando..." : "Iniciar sesión"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

