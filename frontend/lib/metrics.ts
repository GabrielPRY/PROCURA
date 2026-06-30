import { apiRequest } from "@/lib/api";

export type UsageSummary = {
  total_events: number;
  active_users: number;
  active_licitaciones: number;
  tokens_total: number;
  estimated_cost_usd: number;
  errors: number;
  peak_users_hour: number;
  uncosted_events: number;
  by_module: Array<Record<string, unknown>>;
  by_user: Array<Record<string, unknown>>;
  by_day: Array<Record<string, unknown>>;
  by_month: Array<Record<string, unknown>>;
  by_hour: Array<Record<string, unknown>>;
  by_status: Array<Record<string, unknown>>;
  recent_errors: Array<Record<string, unknown>>;
};

export type UsageOptions = {
  users: string[];
  modules: string[];
};

export function getUsageMetrics(params: { days?: number; username?: string; module?: string } = {}) {
  const query = new URLSearchParams();
  query.set("days", String(params.days ?? 30));
  if (params.username && params.username !== "Todos") query.set("username", params.username);
  if (params.module && params.module !== "Todos") query.set("module", params.module);
  return apiRequest<{ status: string; summary: UsageSummary; options: UsageOptions }>(`/metrics/usage?${query.toString()}`);
}
