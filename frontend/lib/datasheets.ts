import { apiRequest } from "@/lib/api";

export function generateDatasheet(payload: {
  username: string;
  licitacion: string;
  codigo_renglon: string;
  pliego_context: string;
  items_context: string;
  gemini_key: string;
}) {
  const formData = new FormData();
  formData.append("username", payload.username);
  formData.append("licitacion", payload.licitacion);
  formData.append("codigo_renglon", payload.codigo_renglon);
  formData.append("pliego_context", payload.pliego_context);
  formData.append("items_context", payload.items_context);
  formData.append("gemini_key", payload.gemini_key);
  return apiRequest<{ status: string; datasheet_md: string; from_cache: boolean }>("/generar-ficha", {
    method: "POST",
    body: formData
  });
}
