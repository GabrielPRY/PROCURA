export type RfqItemLike = {
  renglon?: string | number | null;
  codigo_acp?: string | null;
  descripcion?: string | null;
  termino_de_busqueda_corto?: string | null;
  ficha_tecnica_completa?: string | null;
};

export function itemLabel(item?: RfqItemLike | null, index = 0) {
  if (!item) return `Renglon ${index + 1}`;
  const renglon = item.renglon || index + 1;
  const code = item.codigo_acp || "S/C";
  const description = item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa || "Sin descripcion";
  return `Renglon ${renglon} | ${code} | ${description}`;
}
