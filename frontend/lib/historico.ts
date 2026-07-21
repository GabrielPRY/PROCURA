import { apiRequest } from "@/lib/api";

export type HistoricoRow = Record<string, unknown>;

export type HistoricoResponse = {
  status: string;
  count: number;
  matched_count?: number;
  years: number[];
  rows: HistoricoRow[];
};

export function getHistorico(params: { search?: string; terms?: string[]; anio?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  query.set("search", params.search || "");
  if (params.terms?.length) query.set("terms", params.terms.slice(0, 12).join("\n"));
  query.set("anio", params.anio || "Todos");
  query.set("limit", String(params.limit || 500));
  return apiRequest<HistoricoResponse>(`/historico?${query.toString()}`);
}
