import { apiRequest } from "@/lib/api";

export type AdminUser = {
  Usuario: string;
  Nivel: string;
  Correo?: string;
  Clave_Gemini?: string;
  Clave_Tavily?: string;
};

export type AdminApiKeyStatus = {
  configured: boolean;
  masked: string;
  updated_at: string;
  updated_by: string;
};

export type ApiPricingRow = {
  model: string;
  provider: string;
  plan: string;
  currency: string;
  input_price_per_million: number;
  output_price_per_million: number;
  cache_price_per_million: number;
  search_price_per_1000: number;
  source_url: string;
  updated_at: string;
};

export type TelegramNotificationStatus = {
  enabled: boolean;
  configured: boolean;
  chat_configured: boolean;
  token_configured: boolean;
};

export function getAdminUsers() {
  return apiRequest<{ status: string; users: AdminUser[] }>("/admin/users");
}

export function getAdminApiKeys() {
  return apiRequest<{ status: string; gemini: AdminApiKeyStatus; tavily: AdminApiKeyStatus }>("/admin/api-keys");
}

export function updateAdminApiKeys(payload: { gemini_key?: string; tavily_key?: string; updated_by: string }) {
  return apiRequest<{ status: string; gemini: AdminApiKeyStatus; tavily: AdminApiKeyStatus }>("/admin/api-keys", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getAdminApiPricing() {
  return apiRequest<{ status: string; pricing: ApiPricingRow[] }>("/admin/api-pricing");
}

export function getTelegramNotificationStatus() {
  return apiRequest<{ status: string; telegram: TelegramNotificationStatus }>("/admin/notifications/telegram");
}

export function testTelegramNotification() {
  return apiRequest<{ status: string; message_id?: number }>("/admin/notifications/telegram/test", {
    method: "POST"
  });
}

export function updateAdminUserApiKeys(username: string, payload: { gemini_key?: string; tavily_key?: string }) {
  return apiRequest<{ status: string }>(`/admin/users/${encodeURIComponent(username)}/api-keys`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createAdminUser(payload: { username: string; password: string; role: string }) {
  return apiRequest<{ status: string }>("/admin/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateAdminUserRole(username: string, role: string) {
  return apiRequest<{ status: string }>(`/admin/users/${encodeURIComponent(username)}/role`, {
    method: "POST",
    body: JSON.stringify({ role })
  });
}

export function resetAdminUserPassword(username: string, password: string) {
  return apiRequest<{ status: string }>(`/admin/users/${encodeURIComponent(username)}/password`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export function deleteAdminUser(username: string) {
  return apiRequest<{ status: string }>(`/admin/users/${encodeURIComponent(username)}`, {
    method: "DELETE"
  });
}
