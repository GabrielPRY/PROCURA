import { apiRequest } from "@/lib/api";

export type FreightRate = {
  id: number;
  agente: string;
  tipo_servicio?: string;
  tipo_flete: string;
  tarifa_por_libra: number | string;
  tiempo_transito_dias: number;
  minimo_envio: number | string;
  dia_corte?: string;
  salidas?: string;
  activo?: boolean;
};

export type Forwarder = {
  id: number;
  nombre: string;
  direccion?: string;
  observacion?: string;
  activo?: boolean;
};

export type LocalRate = {
  id: number;
  agente: string;
  destino?: string;
  tipo_flete?: string;
  hasta_400kg?: number | string;
  kg_500_1000?: number | string;
  mayor_1000kg?: number | string;
  activo?: boolean;
};

export type Incoterm = {
  sigla: string;
  incoterm?: string;
  responsabilidades?: Record<string, unknown>;
  notas?: string;
};

export type LogisticsCalculation = {
  id: number;
  created_at: string;
  username?: string;
  licitacion?: string;
  renglon?: string;
  agente?: string;
  tipo_flete?: string;
  incoterm?: string;
  peso_libras?: number | string;
  peso_facturable_libras?: number | string;
  peso_volumetrico_libras?: number | string;
  costo_internacional?: number | string;
  costo_local?: number | string;
  costo_total?: number | string;
  tiempo_transito_dias?: number;
  metadata?: Record<string, unknown>;
};

export type LogisticsSettingsResponse = {
  status: string;
  freight_rates: FreightRate[];
  local_rates: LocalRate[];
  forwarders: Forwarder[];
  incoterms: Incoterm[];
};

export type CarrierStatus = {
  configured: boolean;
  environment: string;
  official: boolean;
};

export type LogisticsCarriersResponse = {
  status: string;
  carriers: {
    shipstation: CarrierStatus;
    ups: CarrierStatus;
    schneider: CarrierStatus;
    address_autocomplete: CarrierStatus;
  };
};

export type AddressSuggestion = {
  id: string;
  formatted: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: "US";
  latitude?: number;
  longitude?: number;
  confidence?: number;
};

export type LogisticsAddress = {
  name?: string;
  address_line?: string;
  city: string;
  state: string;
  postal_code: string;
  country_code?: "US";
  residential?: boolean;
};

export type QuotePackage = {
  package_type?: string;
  quantity: number;
  weight: number;
  weight_unit: "LBS" | "KGS";
  length: number;
  width: number;
  height: number;
  dimension_unit: "IN" | "CM";
  description?: string;
};

export type CarrierQuote = {
  id: string;
  carrier: "UPS" | "Schneider" | string;
  service_code?: string;
  service_name: string;
  total: number;
  currency: string;
  business_days?: number;
  transit_days?: number;
  delivery_date?: string;
  delivery_time?: string;
  pickup_at?: string;
  delivery_at?: string;
  expires_at?: string;
  negotiated?: boolean;
  line_haul?: number;
  fuel?: number;
  accessorials?: number;
  accessorial_list?: unknown[];
  attributes?: string[];
  shipping_amount?: number;
  other_amount?: number;
};

export type CarrierQuoteResponse = {
  status: string;
  provider: string;
  official: boolean;
  environment: string;
  quotes: CarrierQuote[];
};

export function getLogisticsSettings() {
  return apiRequest<LogisticsSettingsResponse>("/logistics/settings");
}

export function getLogisticsCarriersStatus() {
  return apiRequest<LogisticsCarriersResponse>("/logistics/carriers/status");
}

export function getAddressSuggestions(query: string) {
  const params = new URLSearchParams({ q: query.trim() });
  return apiRequest<{ status: string; provider: string; suggestions: AddressSuggestion[] }>(`/logistics/addresses/autocomplete?${params.toString()}`, {
    timeoutMs: 25000,
    retries: 0
  });
}

export function getUpsQuotes(payload: Record<string, unknown>) {
  return apiRequest<CarrierQuoteResponse>("/logistics/quotes/ups", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 70000
  });
}

export function getShipStationQuotes(payload: Record<string, unknown>) {
  return apiRequest<CarrierQuoteResponse>("/logistics/quotes/shipstation", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 80000
  });
}

export function getSchneiderQuotes(payload: Record<string, unknown>) {
  return apiRequest<CarrierQuoteResponse>("/logistics/quotes/schneider", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 90000
  });
}

export function getLogisticsCalculations(limit = 50) {
  return apiRequest<{ status: string; calculations: LogisticsCalculation[] }>(`/logistics/calculations?limit=${limit}`);
}

export function saveLogisticsCalculation(payload: Record<string, unknown>) {
  return apiRequest<{ status: string }>("/logistics/calculations", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteLogisticsCalculation(id: number) {
  return apiRequest<{ status: string }>(`/logistics/calculations/${id}`, {
    method: "DELETE"
  });
}

export type FreightRatePayload = {
  agente: string;
  tipo_servicio?: string;
  tipo_flete?: string;
  tarifa_por_libra?: number;
  tiempo_transito_dias?: number;
  minimo_envio?: number;
  dia_corte?: string;
  salidas?: string;
  activo?: boolean;
};

export type LocalRatePayload = {
  agente: string;
  destino: string;
  tipo_flete?: string;
  hasta_400kg?: number;
  kg_500_1000?: number;
  mayor_1000kg?: number;
  activo?: boolean;
};

export type ForwarderPayload = {
  nombre: string;
  direccion?: string;
  observacion?: string;
  activo?: boolean;
};

export function saveLogisticsFreightRate(payload: FreightRatePayload) {
  return apiRequest<{ status: string; settings?: LogisticsSettingsResponse }>("/logistics/freight-rates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function saveLogisticsLocalRate(payload: LocalRatePayload) {
  return apiRequest<{ status: string; settings?: LogisticsSettingsResponse }>("/logistics/local-rates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function saveLogisticsForwarder(payload: ForwarderPayload) {
  return apiRequest<{ status: string; settings?: LogisticsSettingsResponse }>("/logistics/forwarders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
