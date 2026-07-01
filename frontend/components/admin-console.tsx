"use client";

import { Activity, AlertTriangle, BarChart3, KeyRound, Loader2, RefreshCw, Save, Search, Settings, ShieldCheck, Trash2, UserCog, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createAdminUser,
  deleteAdminUser,
  getAdminApiPricing,
  getAdminApiKeys,
  getAdminUsers,
  resetAdminUserPassword,
  updateAdminApiKeys,
  updateAdminUserApiKeys,
  updateAdminUserRole,
  type AdminApiKeyStatus,
  type AdminUser,
  type ApiPricingRow
} from "@/lib/admin";
import { type AuthUser } from "@/lib/auth";
import { getUsageMetrics, type UsageSummary } from "@/lib/metrics";

const roles = ["Analista", "Supervisor", "Gerencia", "Admin", "Logistica"];
const adminTabs = [
  { id: "resumen", label: "Resumen", description: "Consumo, errores y salud operativa." },
  { id: "apis", label: "APIs", description: "Gemini global y estado de llaves." },
  { id: "usuarios", label: "Usuarios", description: "Roles, contrasenas y accesos." }
] as const;

type AdminTab = (typeof adminTabs)[number]["id"];

const roleHelp: Record<string, string> = {
  Analista: "RFQ, proveedores, historico, costos, seguimiento y logistica.",
  Supervisor: "Funciones de analista mas Radar SLI y seguimiento supervisor.",
  Gerencia: "Vista gerencial, metricas, radar, historico y modulos operativos.",
  Admin: "Solo administracion, usuarios, roles y configuracion critica.",
  Logistica: "Logistica e historico sin analisis RFQ."
};

function normalizeRole(role: string) {
  const value = String(role || "").trim();
  const comparable = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (comparable.includes("log")) return "Logistica";
  return roles.includes(value) ? value : value || "Analista";
}

function isConfiguredSecret(value?: string) {
  const text = String(value || "");
  return Boolean(text) && text !== "Sin configurar" && !text.toLowerCase().includes("no usable");
}

export function AdminConsole({ user }: { user: AuthUser }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("Analista");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [apiStatus, setApiStatus] = useState<AdminApiKeyStatus | null>(null);
  const [globalGeminiKey, setGlobalGeminiKey] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [userApiKeys, setUserApiKeys] = useState<Record<string, { gemini_key: string }>>({});
  const [savingUserApiKey, setSavingUserApiKey] = useState<string | null>(null);
  const [pricing, setPricing] = useState<ApiPricingRow[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [metricsDays, setMetricsDays] = useState(30);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("resumen");

  async function loadMetrics(days = metricsDays) {
    setLoadingMetrics(true);
    try {
      const metrics = await getUsageMetrics({ days });
      setUsage(metrics.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las metricas.");
    } finally {
      setLoadingMetrics(false);
    }
  }

  async function loadUsers() {
    setError(null);
    setLoading(true);
    try {
      const [response, apiKeys, metrics, pricingResponse] = await Promise.all([
        getAdminUsers(),
        getAdminApiKeys(),
        getUsageMetrics({ days: metricsDays }),
        getAdminApiPricing()
      ]);
      setUsers((response.users || []).map((item) => ({ ...item, Nivel: normalizeRole(item.Nivel) })));
      setApiStatus(apiKeys.gemini);
      setUsage(metrics.summary);
      setPricing(pricingResponse.pricing || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los usuarios.");
    } finally {
      setLoading(false);
    }
  }

  async function saveGlobalApiKey() {
    if (!globalGeminiKey.trim()) {
      setError("Pega una Gemini API Key antes de guardar.");
      return;
    }
    setError(null);
    setSavingApiKey(true);
    try {
      const response = await updateAdminApiKeys({ gemini_key: globalGeminiKey.trim(), updated_by: user.username });
      setApiStatus(response.gemini);
      setGlobalGeminiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la API Key global.");
    } finally {
      setSavingApiKey(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    void loadMetrics(metricsDays);
  }, [metricsDays]);

  async function createUser() {
    setError(null);
    setSaving(true);
    try {
      await createAdminUser({ username: newUsername.trim(), password: newPassword, role: newRole });
      setNewUsername("");
      setNewPassword("");
      setNewRole("Analista");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el usuario.");
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(username: string, role: string) {
    setError(null);
    try {
      await updateAdminUserRole(username, role);
      setUsers((current) => current.map((item) => (item.Usuario === username ? { ...item, Nivel: role } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el rol.");
    }
  }

  async function resetPassword(username: string) {
    const password = resetPasswords[username] || "";
    if (!password.trim()) {
      setError("Escribe una contrasena nueva antes de resetear.");
      return;
    }
    setError(null);
    try {
      await resetAdminUserPassword(username, password);
      setResetPasswords((current) => ({ ...current, [username]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo resetear la contrasena.");
    }
  }

  async function saveUserApiKeys(username: string) {
    const keys = userApiKeys[username] || { gemini_key: "" };
    const payload: { gemini_key?: string } = {};
    if (keys.gemini_key.trim()) payload.gemini_key = keys.gemini_key.trim();
    if (!payload.gemini_key) {
      setError("Pega una Gemini API Key para asignarla al usuario.");
      return;
    }
    setError(null);
    setSavingUserApiKey(username);
    try {
      await updateAdminUserApiKeys(username, payload);
      setUserApiKeys((current) => ({ ...current, [username]: { gemini_key: "" } }));
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar las API keys del usuario.");
    } finally {
      setSavingUserApiKey(null);
    }
  }

  async function removeUser(username: string) {
    setError(null);
    try {
      await deleteAdminUser(username);
      setUsers((current) => current.filter((item) => item.Usuario !== username));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el usuario.");
    }
  }

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((item) => [item.Usuario, item.Nivel, item.Correo].some((value) => String(value || "").toLowerCase().includes(term)));
  }, [users, search]);
  const roleCounts = roles.map((role) => [role, users.filter((item) => item.Nivel === role).length] as const);
  const geminiConfigured = users.filter((item) => isConfiguredSecret(item.Clave_Gemini)).length;
  const recentErrors = usage?.recent_errors || [];
  const moduleUsage = usage?.by_module || [];
  const paidGeminiPricing = pricing.filter((row) => row.provider === "gemini");

  function metricValue(value: unknown) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
  }

  function money(value: unknown) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(metricValue(value));
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-brand">Modulo Admin</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Administracion del sistema</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Usuarios, roles, llaves visibles enmascaradas y mantenimiento basico conectado a Supabase por FastAPI.
            </p>
          </div>
          <button
            type="button"
            onClick={loadUsers}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-slate-700"
          >
            <RefreshCw className="h-4 w-4 text-brand" />
            Refrescar
          </button>
        </div>
      </section>

      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}

      <section className="rounded-xl border border-line bg-panel p-2 shadow-sm">
        <div className="grid gap-2 md:grid-cols-3">
          {adminTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg border px-4 py-3 text-left transition ${
                  active ? "border-blue-200 bg-blue-50 text-brand" : "border-transparent text-slate-700 hover:border-line hover:bg-slate-50"
                }`}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{tab.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === "resumen" ? (
        <>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <Users className="h-5 w-5 text-brand" />
          <div className="mt-4 text-3xl font-semibold">{users.length}</div>
          <p className="mt-2 text-sm leading-6 text-muted">Usuarios registrados.</p>
        </div>
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <KeyRound className="h-5 w-5 text-emerald-600" />
          <div className="mt-4 text-3xl font-semibold">{geminiConfigured}/{users.length}</div>
          <p className="mt-2 text-sm leading-6 text-muted">Usuarios con Gemini configurado.</p>
        </div>
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <Settings className="h-5 w-5 text-amber-600" />
          <div className="mt-4 text-3xl font-semibold">{apiStatus?.configured ? "Activa" : "Pendiente"}</div>
          <p className="mt-2 text-sm leading-6 text-muted">Gemini global administrada por Admin.</p>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Activity className="h-4 w-4 text-brand" />
              Monitoreo de consumo y errores
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">Actividad real del sistema por usuario, modulo, tokens, costos estimados y errores recientes.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={metricsDays}
              onChange={(event) => setMetricsDays(Number(event.target.value))}
              className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none"
            >
              <option value={7}>7 dias</option>
              <option value={30}>30 dias</option>
              <option value={90}>90 dias</option>
              <option value={180}>180 dias</option>
            </select>
            {loadingMetrics ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ["Eventos", String(usage?.total_events || 0), "Actividad registrada", BarChart3],
            ["Usuarios activos", String(usage?.active_users || 0), "En el periodo", Users],
            ["Costo estimado", money(usage?.estimated_cost_usd), "APIs IA", KeyRound],
            ["Errores", String(usage?.errors || 0), "Fallos por modulo", AlertTriangle]
          ].map(([label, value, hint, Icon]) => (
            <div key={String(label)} className="rounded-lg border border-line bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label as string}</div>
                <Icon className="h-4 w-4 text-brand" />
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{value as string}</div>
              <div className="mt-1 text-xs text-muted">{hint as string}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="text-sm font-semibold text-blue-900">Base real del costo API</div>
              <p className="mt-1 text-sm leading-6 text-blue-800">
                El costo se calcula con tokens reales reportados por Gemini y tarifas guardadas en la tabla api_pricing. Los eventos antiguos sin separacion de entrada/salida se excluyen del costo para no inventar gasto.
              </p>
              {usage?.uncosted_events ? (
                <div className="mt-2 text-xs font-semibold text-blue-900">
                  {usage.uncosted_events} evento(s) antiguo(s) quedaron sin costo por no tener tokens de entrada/salida.
                </div>
              ) : null}
            </div>
            <div className="grid min-w-0 gap-2">
              {paidGeminiPricing.map((row) => (
                <div key={row.model} className="rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-slate-700">
                  <div className="font-semibold text-slate-950">{row.model}</div>
                  <div>Entrada: {money(row.input_price_per_million)} / 1M tokens</div>
                  <div>Salida: {money(row.output_price_per_million)} / 1M tokens</div>
                  <div>Search grounding: {money(row.search_price_per_1000)} / 1,000 prompts</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">Uso por modulo</div>
            <div className="mt-3 overflow-hidden rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="border-b border-line px-3 py-2">Modulo</th>
                    <th className="border-b border-line px-3 py-2">Eventos</th>
                    <th className="border-b border-line px-3 py-2">Errores</th>
                    <th className="border-b border-line px-3 py-2">Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {moduleUsage.slice(0, 8).map((row, index) => (
                    <tr key={`${String(row.module)}-${index}`}>
                      <td className="px-3 py-2 font-semibold text-slate-900">{String(row.module || row.Modulo || "N/D")}</td>
                      <td className="px-3 py-2">{String(row.events || row.eventos || row.total || 0)}</td>
                      <td className="px-3 py-2">{String(row.errors || row.errores || 0)}</td>
                      <td className="px-3 py-2">{money(row.estimated_cost_usd || row.cost_usd || row.costo_estimado || row.costo || 0)}</td>
                    </tr>
                  ))}
                  {!moduleUsage.length ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-5 text-center text-muted">Sin metricas registradas aun.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">Errores recientes</div>
            <div className="mt-3 space-y-2">
              {recentErrors.slice(0, 6).map((row, index) => (
                <div key={index} className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                  <div className="text-sm font-semibold text-rose-800">
                    {String(row.module || row.Modulo || "Modulo")} | {String(row.action || row.Accion || "Accion")}
                  </div>
                  <div className="mt-1 text-xs text-rose-700">{String(row.error_message || row.error || row.Error || "Sin detalle")}</div>
                </div>
              ))}
              {!recentErrors.length ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  No hay errores recientes en el periodo seleccionado.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

        </>
      ) : null}

      {activeTab === "apis" ? (
      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <KeyRound className="h-4 w-4 text-brand" />
              API administrada por Admin
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Esta llave global se usa como respaldo cuando un usuario no tiene llave propia configurada. El sourcing nuevo se centraliza en Gemini.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Gemini</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{apiStatus?.configured ? apiStatus.masked : "Sin configurar"}</div>
              </div>
              <div className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Actualizado por</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{apiStatus?.updated_by || "N/D"}</div>
              </div>
            </div>
          </div>
          <div className="grid w-full max-w-xl gap-4">
          <div className="rounded-xl border border-line bg-slate-50 p-4">
            <label className="grid gap-2 text-sm font-semibold text-slate-800">
              Nueva Gemini API Key global
              <input
                value={globalGeminiKey}
                onChange={(event) => setGlobalGeminiKey(event.target.value)}
                placeholder="Pegar llave Gemini de la empresa"
                type="password"
                className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none"
              />
            </label>
            <button
              type="button"
              onClick={saveGlobalApiKey}
              disabled={savingApiKey || !globalGeminiKey.trim()}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {savingApiKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar llave global
            </button>
          </div>
          </div>
        </div>
      </section>

      ) : null}

      {activeTab === "usuarios" ? (
        <>
      <section className="grid gap-3 md:grid-cols-5">
        {roleCounts.map(([role, count]) => (
          <div key={role} className="rounded-xl border border-line bg-panel p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">{role}</div>
              <ShieldCheck className="h-4 w-4 text-brand" />
            </div>
            <div className="mt-2 text-2xl font-semibold">{count}</div>
            <p className="mt-1 text-xs leading-5 text-muted">{roleHelp[role]}</p>
          </div>
        ))}
      </section>

      <details className="rounded-xl border border-line bg-panel shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
          <div>
            <div className="text-sm font-semibold text-slate-900">Crear usuario</div>
            <p className="mt-1 text-sm text-muted">Alta manual de usuarios para la beta interna.</p>
          </div>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">Nuevo</span>
        </summary>
        <div className="grid gap-3 border-t border-line p-5 lg:grid-cols-[1fr_1fr_0.7fr_auto]">
          <input
            value={newUsername}
            onChange={(event) => setNewUsername(event.target.value)}
            placeholder="Usuario"
            className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none"
          />
          <input
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Contrasena temporal"
            type="password"
            className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none"
          />
          <select
            value={newRole}
            onChange={(event) => setNewRole(event.target.value)}
            className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none"
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={createUser}
            disabled={saving || !newUsername.trim() || !newPassword.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
            Crear
          </button>
        </div>
      </details>

      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Usuarios existentes</div>
            <p className="mt-1 text-sm text-muted">Cambia roles, resetea contrasenas y revisa si cada usuario tiene llaves configuradas.</p>
          </div>
          <label className="relative block lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar usuario, rol o correo..."
              className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none"
            />
          </label>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          {filteredUsers.length ? (
            <div className="divide-y divide-line">
              {filteredUsers.map((item) => {
                const apiDraft = userApiKeys[item.Usuario] || { gemini_key: "" };
                return (
                  <div key={item.Usuario} className="bg-white p-4">
                    <div className="grid gap-3 xl:grid-cols-[0.9fr_0.7fr_1fr_1fr_auto] xl:items-center">
                      <div>
                        <div className="font-semibold text-slate-900">{item.Usuario}</div>
                        <div className="mt-1 text-xs text-muted">{item.Correo || "Sin correo"}</div>
                        <div className="mt-2 text-xs leading-5 text-slate-500">{roleHelp[item.Nivel] || "Rol personalizado."}</div>
                      </div>
                      <select
                        value={item.Nivel}
                        onChange={(event) => changeRole(item.Usuario, event.target.value)}
                        disabled={item.Usuario.toLowerCase() === "admin"}
                        className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none disabled:bg-slate-100"
                      >
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <span className={`rounded-full px-2.5 py-1 ${isConfiguredSecret(item.Clave_Gemini) ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
                          Gemini: {item.Clave_Gemini || "Sin configurar"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={resetPasswords[item.Usuario] || ""}
                          onChange={(event) => setResetPasswords((current) => ({ ...current, [item.Usuario]: event.target.value }))}
                          placeholder="Nueva contrasena"
                          type="password"
                          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => resetPassword(item.Usuario)}
                          className="rounded-lg border border-line bg-slate-50 px-3 text-xs font-semibold text-slate-700"
                        >
                          Reset
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeUser(item.Usuario)}
                        disabled={item.Usuario.toLowerCase() === "admin" || item.Usuario === user.username}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Borrar
                      </button>
                    </div>
                    <div className="mt-4 rounded-xl border border-line bg-slate-50 p-3">
                      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                        <KeyRound className="h-3.5 w-3.5 text-brand" />
                        Asignar Gemini API Key a este usuario
                      </div>
                      <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
                        <input
                          value={apiDraft.gemini_key}
                          onChange={(event) =>
                            setUserApiKeys((current) => ({
                              ...current,
                              [item.Usuario]: { ...(current[item.Usuario] || { gemini_key: "" }), gemini_key: event.target.value }
                            }))
                          }
                          placeholder="Gemini API Key"
                          type="password"
                          className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => saveUserApiKeys(item.Usuario)}
                          disabled={savingUserApiKey === item.Usuario || !apiDraft.gemini_key.trim()}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {savingUserApiKey === item.Usuario ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Guardar llaves
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-slate-50 p-5 text-sm text-muted">No hay usuarios para mostrar.</div>
          )}
        </div>
      </section>
        </>
      ) : null}
    </div>
  );
}
