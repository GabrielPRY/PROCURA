import { apiRequest } from "@/lib/api";

export type HistoricoRow = Record<string, unknown>;

export function getHistorico(params: { search?: string; anio?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  query.set("search", params.search || "");
  query.set("anio", params.anio || "Todos");
  query.set("limit", String(params.limit || 500));
  return apiRequest<{ status: string; count: number; years: number[]; rows: HistoricoRow[] }>(`/historico?${query.toString()}`);
}
