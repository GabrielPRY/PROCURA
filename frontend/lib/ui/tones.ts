export type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

export function statusTone(value?: string | null): Tone {
  const text = String(value || "").toLowerCase();
  if (/ganad|adjudic|aprob|cumple|anuncio|abiert|activo/.test(text)) return "ok";
  if (/evalu|seguim|pend|revision|revisar|prepar/.test(text)) return "warn";
  if (/perdid|descart|cancel|rechaz|no cumple|error|fall/.test(text)) return "danger";
  if (/sli|radar|nuevo|info/.test(text)) return "info";
  return "neutral";
}

export function riskTone(value?: string | null): Tone {
  const text = String(value || "").toLowerCase();
  if (/bajo|seguro|confiable/.test(text)) return "ok";
  if (/alto|critico|fraude|fantasma|descartar/.test(text)) return "danger";
  if (/medio|validar|cautela|revisar/.test(text)) return "warn";
  return "neutral";
}

export function decisionTone(value?: string | null): Tone {
  const text = String(value || "").toLowerCase();
  if (/avanz|particip|cotizar|usar|recomend/.test(text)) return "ok";
  if (/descart|no avanzar|evitar|rechaz/.test(text)) return "danger";
  if (/validar|cautela|revisar|parcial/.test(text)) return "warn";
  return "neutral";
}
