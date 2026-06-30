import { apiRequest } from "@/lib/api";

export type ProcuraRole = "Analista" | "Supervisor" | "Gerencia" | "Admin" | "Logistica" | string;

export type AuthUser = {
  username: string;
  role: ProcuraRole;
  session_token?: string;
};

export type LoginResponse = {
  status: string;
  username: string;
  role: ProcuraRole;
  session_token?: string;
};

export const SESSION_KEY = "procura_frontend_session";

export async function login(username: string, password: string) {
  const response = await apiRequest<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return { username: response.username, role: response.role, session_token: response.session_token };
}

export function saveSession(user: AuthUser) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

export function loadSession(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed.username || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export function normalizeRole(role: ProcuraRole) {
  const value = String(role || "Analista");
  const comparable = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (comparable.toLowerCase() === "logistica") return "Logistica";
  return comparable;
}
