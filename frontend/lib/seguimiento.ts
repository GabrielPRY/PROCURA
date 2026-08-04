import { apiRequest } from "@/lib/api";
import { type SliLookupResult } from "@/lib/sli";

export type Seguimiento = {
  id: number;
  numero_licitacion: string;
  owner_username?: string;
  objeto?: string;
  fecha_asignacion?: string;
  fecha_envio_oferta?: string;
  monto_ofertado?: number | string;
  moneda?: string;
  estado?: string;
  link_sli?: string;
  notas?: string;
  responsable?: string;
  fecha_registro?: string;
  sli_snapshot?: SliLookupResult | null;
  sli_checked_at?: string;
};

export type SeguimientoHistorial = {
  fecha: string;
  estado_nuevo: string;
  nota?: string;
  registrado_por?: string;
};

export function getSeguimientos(params?: { username?: string; role?: string }) {
  const query = new URLSearchParams();
  if (params?.username) query.set("username", params.username);
  if (params?.role) query.set("role", params.role);
  return apiRequest<{ status: string; seguimientos: Seguimiento[] }>(`/seguimiento${query.toString() ? `?${query}` : ""}`);
}

export function createSeguimiento(payload: Partial<Seguimiento>) {
  return apiRequest<{ status: string; seguimiento?: Seguimiento }>("/seguimiento", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getSeguimientoHistorial(id: number) {
  return apiRequest<{ status: string; historial: SeguimientoHistorial[] }>(`/seguimiento/${id}/historial`);
}

export function saveSeguimientoSliSnapshot(id: number, snapshot: SliLookupResult) {
  return apiRequest<{ status: string; id: number; sli_checked_at: string }>(`/seguimiento/${id}/sli-snapshot`, {
    method: "POST",
    body: JSON.stringify({ snapshot })
  });
}

export function updateSeguimientoEstado(id: number, payload: { estado: string; nota: string; registrado_por: string }) {
  return apiRequest<{ status: string }>(`/seguimiento/${id}/estado`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteSeguimiento(id: number) {
  return apiRequest<{ status: string }>(`/seguimiento/${id}`, {
    method: "DELETE"
  });
}
