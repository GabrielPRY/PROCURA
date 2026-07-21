import { apiRequest } from "@/lib/api";

export type WorkspaceListItem = {
  username: string;
  licitacion: string;
  fecha_guardado: string;
  renglones?: number;
  objeto?: string;
  entidad?: string;
  fecha_cierre?: string;
  empresa_sugerida?: string;
  riesgo?: string;
};

export function listWorkspaces(username: string, allUsers = false) {
  return apiRequest<{ status: string; workspaces: WorkspaceListItem[] }>(
    `/workspaces/${encodeURIComponent(username)}/list?all_users=${allUsers ? "true" : "false"}`
  );
}

export function loadWorkspace(username: string, licitacion: string) {
  return apiRequest<{ status: string; data: unknown[]; condiciones_generales: Record<string, unknown> }>(
    `/workspaces/${encodeURIComponent(username)}/${encodeURIComponent(licitacion)}`
  );
}

export function deleteWorkspace(username: string, licitacion: string) {
  return apiRequest<{ status: string }>(`/workspaces/${encodeURIComponent(username)}/${encodeURIComponent(licitacion)}`, {
    method: "DELETE"
  });
}

export function saveWorkspace(payload: {
  username: string;
  licitacion: string;
  data: Array<Record<string, unknown>>;
  condiciones_generales: Record<string, unknown>;
}) {
  return apiRequest<{ status: string; licitacion: string }>("/workspaces", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
