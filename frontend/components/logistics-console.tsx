"use client";

import {
  ArrowRight,
  Check,
  Clock3,
  History,
  Loader2,
  MapPin,
  MapPinned,
  PackagePlus,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Truck,
  Warehouse
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type AuthUser } from "@/lib/auth";
import {
  deleteLogisticsCalculation,
  getAddressSuggestions,
  getLogisticsCalculations,
  getLogisticsCarriersStatus,
  getLogisticsSettings,
  getUpsQuotes,
  saveLogisticsCalculation,
  saveLogisticsForwarder,
  type AddressSuggestion,
  type CarrierQuote,
  type Forwarder,
  type LogisticsAddress,
  type LogisticsCalculation,
  type LogisticsCarriersResponse,
  type QuotePackage
} from "@/lib/logistics";
import {
  cleanValue,
  loadActiveRfqContext,
  loadLastRfq,
  type RfqAnalysisResponse,
  type RfqItem
} from "@/lib/rfq";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type ViewId = "ups" | "history" | "settings";

type PackageRow = QuotePackage & {
  id: number;
  load_type: "Paquete" | "Caja" | "Pallet" | "Crate" | "Tambor";
};

const EMPTY_ADDRESS: LogisticsAddress = {
  name: "",
  address_line: "",
  city: "",
  state: "",
  postal_code: "",
  country_code: "US",
  residential: false
};

function createPackage(id = Date.now()): PackageRow {
  return {
    id,
    load_type: "Caja",
    package_type: "02",
    quantity: 1,
    weight: 10,
    weight_unit: "LBS",
    length: 12,
    width: 12,
    height: 12,
    dimension_unit: "IN",
    description: ""
  };
}

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function dateLabel(value?: string) {
  if (!value) return "No informado";
  if (/^\d{8}$/.test(value)) return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("es-PA", { dateStyle: "medium", timeStyle: "short" });
}

function itemLabel(item: RfqItem, index: number) {
  const row = cleanValue(item.renglon, String(index + 1));
  const code = cleanValue(item.codigo_articulo, "Sin código ACP");
  const description = cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "Sin descripción");
  return `Renglón ${row} | ${code} | ${description.slice(0, 70)}`;
}

function parseForwarderAddress(forwarder: Forwarder): LogisticsAddress {
  const raw = String(forwarder.direccion || "").trim();
  const postal = raw.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || "";
  const state = raw.match(/\b([A-Z]{2})\b\s*\d{5}/i)?.[1]?.toUpperCase() || "FL";
  const city = /medley/i.test(raw) ? "Medley" : /miami/i.test(raw) ? "Miami" : "";
  return {
    name: forwarder.nombre,
    address_line: raw,
    city,
    state,
    postal_code: postal,
    country_code: "US",
    residential: false
  };
}

function isUsForwarder(forwarder: Forwarder) {
  const raw = String(forwarder.direccion || "");
  return /\b\d{5}(?:-\d{4})?\b/.test(raw) && (/\b[A-Z]{2}\b\s*\d{5}/i.test(raw) || /united states|miami|medley/i.test(raw));
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid min-w-0 gap-1.5 text-xs font-semibold text-slate-700 ${className}`}>
      {label}
      {children}
    </label>
  );
}

function AddressAutocompleteInput({
  value,
  onChange,
  enabled
}: {
  value: LogisticsAddress;
  onChange: (next: LogisticsAddress) => void;
  enabled: boolean;
}) {
  const [query, setQuery] = useState(value.address_line || "");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const skipQuery = useRef("");

  useEffect(() => {
    if (!touched || (!open && value.address_line !== query)) setQuery(value.address_line || "");
  }, [open, query, touched, value.address_line]);

  useEffect(() => {
    const clean = query.trim();
    if (!enabled || !touched || clean.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    if (skipQuery.current === clean) {
      skipQuery.current = "";
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      getAddressSuggestions(clean)
        .then((response) => {
          if (!active) return;
          setSuggestions(response.suggestions || []);
          setOpen(true);
        })
        .catch(() => {
          if (!active) return;
          setSuggestions([]);
          setOpen(false);
        })
        .finally(() => active && setSearching(false));
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [enabled, query, touched]);

  function selectSuggestion(suggestion: AddressSuggestion) {
    const street = suggestion.address_line || suggestion.formatted;
    skipQuery.current = street.trim();
    setQuery(street);
    setSuggestions([]);
    setOpen(false);
    setTouched(false);
    onChange({
      ...value,
      address_line: street,
      city: suggestion.city || value.city,
      state: suggestion.state || value.state,
      postal_code: suggestion.postal_code || value.postal_code,
      country_code: "US"
    });
  }

  return (
    <div className="relative min-w-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setTouched(true);
          onChange({ ...value, address_line: next });
        }}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className="app-input pl-9 pr-9"
        placeholder={enabled ? "Buscar calle o dirección en USA" : "Calle y número"}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
      />
      {searching ? <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-brand" /> : null}
      {open && suggestions.length ? (
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl" role="listbox">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              role="option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
              className="flex w-full min-w-0 items-start gap-2 rounded-md px-3 py-2.5 text-left hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none"
            >
              <MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span className="min-w-0"><span className="block text-sm font-semibold leading-5 text-ink">{suggestion.address_line || suggestion.formatted}</span><span className="block truncate text-xs text-muted">{[suggestion.city, suggestion.state, suggestion.postal_code].filter(Boolean).join(", ")}</span></span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddressFields({
  title,
  icon,
  value,
  onChange,
  forwarders,
  selectedForwarder,
  onForwarderChange,
  showForwarders = false,
  autocompleteEnabled = false
}: {
  title: string;
  icon: ReactNode;
  value: LogisticsAddress;
  onChange: (next: LogisticsAddress) => void;
  forwarders: Forwarder[];
  selectedForwarder: string;
  onForwarderChange: (id: string) => void;
  showForwarders?: boolean;
  autocompleteEnabled?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">{icon}{title}</div>
      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
        {showForwarders ? (
          <Field label="Forwarder de destino" className="sm:col-span-2">
            <select value={selectedForwarder} onChange={(event) => onForwarderChange(event.target.value)} className="app-input">
              <option value="">Ingresar destino manualmente</option>
              {forwarders.map((item) => <option key={item.id} value={String(item.id)}>{item.nombre} | {item.direccion || "Sin dirección"}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label={showForwarders ? "Nombre del forwarder" : "Proveedor / punto de recogida"} className="sm:col-span-2">
          <input value={value.name || ""} onChange={(event) => onChange({ ...value, name: event.target.value })} className="app-input" placeholder={showForwarders ? "Nombre del forwarder" : "Nombre del proveedor"} />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <AddressAutocompleteInput value={value} onChange={onChange} enabled={autocompleteEnabled} />
        </Field>
        <Field label="Ciudad">
          <input required value={value.city} onChange={(event) => onChange({ ...value, city: event.target.value })} className="app-input" placeholder="Miami" />
        </Field>
        <Field label="Estado">
          <input required maxLength={2} value={value.state} onChange={(event) => onChange({ ...value, state: event.target.value.toUpperCase() })} className="app-input uppercase" placeholder="FL" />
        </Field>
        <Field label="ZIP Code">
          <input required inputMode="numeric" value={value.postal_code} onChange={(event) => onChange({ ...value, postal_code: event.target.value })} className="app-input" placeholder="33166" />
        </Field>
        <label className="flex h-11 items-center gap-2 self-end rounded-lg border border-line bg-slate-50 px-3 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={Boolean(value.residential)} onChange={(event) => onChange({ ...value, residential: event.target.checked })} className="h-4 w-4 accent-blue-600" />
          Dirección residencial
        </label>
      </div>
    </div>
  );
}

function PackagesEditor({ packages, onChange }: { packages: PackageRow[]; onChange: (next: PackageRow[]) => void }) {
  function update(id: number, patch: Partial<PackageRow>) {
    onChange(packages.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  return (
    <div className="space-y-3">
      {packages.map((row, index) => (
        <div key={row.id} className="rounded-lg border border-line bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-ink">Unidad de carga {index + 1}</div>
            <Button type="button" onClick={() => packages.length > 1 && onChange(packages.filter((item) => item.id !== row.id))} disabled={packages.length === 1} variant="ghost" size="icon" aria-label="Eliminar unidad" title="Eliminar unidad"><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Tipo">
              <select value={row.load_type} onChange={(event) => update(row.id, { load_type: event.target.value as PackageRow["load_type"] })} className="app-input">
                <option>Paquete</option><option>Caja</option><option>Pallet</option><option>Crate</option><option>Tambor</option>
              </select>
            </Field>
            <Field label="Cantidad"><input type="number" min={1} max={50} value={row.quantity} onChange={(event) => update(row.id, { quantity: Number(event.target.value) })} className="app-input" /></Field>
            <Field label="Peso por unidad">
              <div className="grid grid-cols-[minmax(0,1fr)_76px] gap-2"><input type="number" min={0.01} step="any" value={row.weight} onChange={(event) => update(row.id, { weight: Number(event.target.value) })} className="app-input" /><select value={row.weight_unit} onChange={(event) => update(row.id, { weight_unit: event.target.value as QuotePackage["weight_unit"] })} className="app-input"><option value="LBS">lb</option><option value="KGS">kg</option></select></div>
            </Field>
            <Field label="Unidad dimensional"><select value={row.dimension_unit} onChange={(event) => update(row.id, { dimension_unit: event.target.value as QuotePackage["dimension_unit"] })} className="app-input"><option value="IN">pulgadas</option><option value="CM">centímetros</option></select></Field>
            <Field label="Largo"><input type="number" min={0.01} step="any" value={row.length} onChange={(event) => update(row.id, { length: Number(event.target.value) })} className="app-input" /></Field>
            <Field label="Ancho"><input type="number" min={0.01} step="any" value={row.width} onChange={(event) => update(row.id, { width: Number(event.target.value) })} className="app-input" /></Field>
            <Field label="Alto"><input type="number" min={0.01} step="any" value={row.height} onChange={(event) => update(row.id, { height: Number(event.target.value) })} className="app-input" /></Field>
            <Field label="Descripción"><input value={row.description || ""} onChange={(event) => update(row.id, { description: event.target.value })} className="app-input" placeholder="Producto o mercancía" /></Field>
          </div>
        </div>
      ))}
      <Button type="button" onClick={() => onChange([...packages, createPackage()])} variant="secondary" size="md"><Plus className="h-4 w-4" />Agregar unidad</Button>
    </div>
  );
}

function CarrierState({ configured, environment, name }: { configured?: boolean; environment?: string; name: string }) {
  return configured ? (
    <div className="flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800"><ShieldCheck className="h-4 w-4 shrink-0" /><span>{name} conectado | {environment === "production" ? "Producción" : "Pruebas"}</span></div>
  ) : (
    <div className="max-w-full min-w-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 sm:max-w-md">{name} pendiente de credenciales. El formulario queda listo, pero no genera precios simulados.</div>
  );
}

export function LogisticsConsole({ user }: { user: AuthUser }) {
  const [view, setView] = useState<ViewId>("ups");
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [forwarders, setForwarders] = useState<Forwarder[]>([]);
  const [selectedForwarder, setSelectedForwarder] = useState("");
  const [origin, setOrigin] = useState<LogisticsAddress>({ ...EMPTY_ADDRESS });
  const [destination, setDestination] = useState<LogisticsAddress>({ ...EMPTY_ADDRESS, city: "Miami", state: "FL" });
  const [packages, setPackages] = useState<PackageRow[]>([createPackage(1)]);
  const [pickupDate, setPickupDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [declaredValue, setDeclaredValue] = useState(0);
  const [carrierStatus, setCarrierStatus] = useState<LogisticsCarriersResponse["carriers"] | null>(null);
  const [quotes, setQuotes] = useState<CarrierQuote[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [quoteEnvironment, setQuoteEnvironment] = useState("");
  const [calculations, setCalculations] = useState<LogisticsCalculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forwarderForm, setForwarderForm] = useState({ nombre: "", direccion: "", observacion: "", activo: true });
  const [savingForwarder, setSavingForwarder] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const role = String(user.role || "");
  const canManageLogistics = ["Logistica", "Logística", "Admin"].includes(role);

  useEffect(() => {
    const saved = loadLastRfq(user.username);
    const context = loadActiveRfqContext(user.username);
    setRfq(saved);
    if (saved?.items?.length && context?.target_module === "logistica") setSelectedIndex(Math.min(Math.max(Number(context.item_index) || 0, 0), saved.items.length - 1));
  }, [user.username]);

  useEffect(() => {
    let mounted = true;
    Promise.all([getLogisticsSettings(), getLogisticsCalculations(100), getLogisticsCarriersStatus()])
      .then(([settings, history, status]) => {
        if (!mounted) return;
        const active = (settings.forwarders || []).filter((item) => item.activo !== false && isUsForwarder(item));
        setForwarders(active);
        setCalculations(history.calculations || []);
        setCarrierStatus(status.carriers);
        if (active.length) {
          setSelectedForwarder(String(active[0].id));
          setDestination(parseForwarderAddress(active[0]));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar Logística."))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const items = useMemo(() => rfq?.items || [], [rfq]);
  const selectedItem = items[selectedIndex];
  const licitacion = cleanValue(rfq?.condiciones_generales?.numero_licitacion, "");
  const renglon = cleanValue(selectedItem?.renglon, "");
  const selectedQuote = quotes.find((item) => item.id === selectedQuoteId) || quotes[0];
  const visibleCalculations = canManageLogistics ? calculations : calculations.filter((item) => !item.username || item.username.toLowerCase() === user.username.toLowerCase());

  function chooseForwarder(id: string) {
    setSelectedForwarder(id);
    const selected = forwarders.find((item) => String(item.id) === id);
    if (selected) setDestination(parseForwarderAddress(selected));
  }

  function commonPayload() {
    return {
      username: user.username,
      origin,
      destination,
      licitacion,
      renglon
    };
  }

  async function quoteUps() {
    setError(null);
    setQuotes([]);
    setQuoting(true);
    try {
      const response = await getUpsQuotes({
        ...commonPayload(),
        pickup_date: pickupDate,
        declared_value: declaredValue,
        packages: packages.map(({ id: _id, load_type: _loadType, ...row }) => row)
      });
      setQuotes(response.quotes || []);
      setSelectedQuoteId(response.quotes?.[0]?.id || "");
      setQuoteEnvironment(response.environment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cotizar con UPS.");
    } finally {
      setQuoting(false);
    }
  }

  async function saveQuote() {
    if (!selectedQuote) return;
    setSavingQuote(true);
    setError(null);
    try {
      const weightLb = packages.reduce((sum, row) => sum + row.quantity * row.weight * (row.weight_unit === "KGS" ? 2.20462 : 1), 0);
      await saveLogisticsCalculation({
        username: user.username,
        licitacion,
        renglon,
        agente: selectedQuote.carrier,
        tipo_flete: selectedQuote.service_name,
        incoterm: "",
        peso_libras: weightLb,
        peso_kg: weightLb * 0.453592,
        costo_internacional: selectedQuote.total,
        costo_local: 0,
        costo_total: selectedQuote.total,
        tiempo_transito_dias: selectedQuote.business_days || selectedQuote.transit_days || 0,
        metadata: {
          source: "official-carrier-api",
          official: true,
          environment: quoteEnvironment,
          quote: selectedQuote,
          origin,
          destination,
          packages
        }
      });
      const history = await getLogisticsCalculations(100);
      setCalculations(history.calculations || []);
      setView("history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la cotización.");
    } finally {
      setSavingQuote(false);
    }
  }

  async function removeCalculation(id: number) {
    try {
      await deleteLogisticsCalculation(id);
      setCalculations((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar la cotización.");
    }
  }

  async function saveForwarder() {
    setSavingForwarder(true);
    setSettingsSaved(false);
    setError(null);
    try {
      await saveLogisticsForwarder(forwarderForm);
      const settings = await getLogisticsSettings();
      setForwarders((settings.forwarders || []).filter((item) => item.activo !== false && isUsForwarder(item)));
      setSettingsSaved(true);
      setForwarderForm({ nombre: "", direccion: "", observacion: "", activo: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el forwarder.");
    } finally {
      setSavingForwarder(false);
    }
  }

  const tabs: { id: ViewId; label: string; icon: typeof Truck }[] = [
    { id: "ups", label: "UPS", icon: PackagePlus },
    { id: "history", label: "Cotizaciones guardadas", icon: History },
    ...(canManageLogistics ? [{ id: "settings" as ViewId, label: "Forwarders", icon: Settings2 }] : [])
  ];

  function QuoteResults() {
    if (!quotes.length) return null;
    return (
      <ModuleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-base font-semibold text-ink">Opciones disponibles</h3><p className="mt-1 text-sm text-muted">Precios recibidos directamente del transportista.</p></div>
          <StatusBadge tone="ok"><ShieldCheck className="h-3.5 w-3.5" />Cotización oficial</StatusBadge>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {quotes.map((quote) => {
            const active = selectedQuote?.id === quote.id;
            return (
              <button key={quote.id} type="button" onClick={() => setSelectedQuoteId(quote.id)} className={`min-w-0 rounded-lg border p-4 text-left transition ${active ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : "border-line bg-panel hover:border-blue-300"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="truncate text-sm font-semibold text-ink">{quote.service_name}</div><div className="mt-1 text-xs text-muted">{quote.service_code || quote.carrier}</div></div>
                  {active ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-600 text-white"><Check className="h-4 w-4" /></span> : null}
                </div>
                <div className="mt-4 text-2xl font-bold text-ink">{money(quote.total, quote.currency)}</div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                  {(quote.business_days || quote.transit_days) ? <span className="rounded-full bg-slate-100 px-2 py-1">{quote.business_days || quote.transit_days} día(s) hábiles</span> : null}
                  {(quote.delivery_date || quote.delivery_at) ? <span className="rounded-full bg-slate-100 px-2 py-1">Entrega: {dateLabel(quote.delivery_date || quote.delivery_at)}</span> : null}
                  {quote.negotiated ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">Tarifa negociada</span> : null}
                </div>
                {quote.carrier === "Schneider" ? <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs"><span>Base<br /><strong>{money(quote.line_haul || 0)}</strong></span><span>Combustible<br /><strong>{money(quote.fuel || 0)}</strong></span><span>Adicionales<br /><strong>{money(quote.accessorials || 0)}</strong></span></div> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end"><Button type="button" onClick={saveQuote} disabled={!selectedQuote || savingQuote} variant="primary" size="lg">{savingQuote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar cotización seleccionada</Button></div>
      </ModuleSection>
    );
  }

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader eyebrow="Logística doméstica USA" title="Cotizador de transporte" copy="Desde el proveedor hasta el forwarder en Estados Unidos." actions={<StatusBadge tone={items.length ? "info" : "neutral"}>{items.length ? "RFQ conectado" : "Cotización manual"}</StatusBadge>} />
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4" role="tablist" aria-label="Cotizadores logísticos">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.id;
            return <button key={tab.id} type="button" role="tab" aria-selected={active} onClick={() => { setView(tab.id); setQuotes([]); setError(null); }} className={`app-tab-button inline-flex h-10 items-center gap-2 px-3 text-sm font-semibold ${active ? "app-tab-button-active" : ""}`}><Icon className="h-4 w-4" />{tab.label}{tab.id === "history" && visibleCalculations.length ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{visibleCalculations.length}</span> : null}</button>;
          })}
        </div>
      </ModuleSection>

      {error ? <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section> : null}
      {loading ? <section className="flex items-center gap-2 rounded-xl border border-line bg-panel p-4 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Cargando configuración logística...</section> : null}

      {view === "ups" ? (
        <>
          <ModuleSection>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-base font-semibold text-ink">Cotización UPS</h3><p className="mt-1 text-sm text-muted">Ruta doméstica: proveedor en USA <ArrowRight className="mx-1 inline h-3.5 w-3.5" /> forwarder en USA.</p></div>
              <CarrierState name="UPS" configured={carrierStatus?.ups.configured} environment={carrierStatus?.ups.environment} />
            </div>
            {items.length ? <div className="mt-5"><Field label="Renglón relacionado"><select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))} className="app-input">{items.map((item, index) => <option key={`${item.renglon}-${index}`} value={index}>{itemLabel(item, index)}</option>)}</select></Field></div> : null}
          </ModuleSection>

          <ModuleSection>
            <div className="grid min-w-0 gap-6 xl:grid-cols-2 xl:divide-x xl:divide-line">
              <AddressFields title="Origen: proveedor" icon={<MapPin className="h-4 w-4 text-brand" />} value={origin} onChange={setOrigin} forwarders={forwarders} selectedForwarder="" onForwarderChange={() => undefined} autocompleteEnabled={Boolean(carrierStatus?.address_autocomplete.configured)} />
              <div className="xl:pl-6"><AddressFields title="Destino: forwarder" icon={<Warehouse className="h-4 w-4 text-brand" />} value={destination} onChange={setDestination} forwarders={forwarders} selectedForwarder={selectedForwarder} onForwarderChange={chooseForwarder} showForwarders autocompleteEnabled={Boolean(carrierStatus?.address_autocomplete.configured)} /></div>
            </div>
          </ModuleSection>

          <ModuleSection>
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-ink">Carga</h3><p className="mt-1 text-sm text-muted">Peso y dimensiones por cada tipo de unidad.</p></div><StatusBadge tone="neutral">{packages.reduce((sum, row) => sum + row.quantity, 0)} pieza(s)</StatusBadge></div>
            <div className="mt-4"><PackagesEditor packages={packages} onChange={setPackages} /></div>
          </ModuleSection>

          <ModuleSection>
            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Fecha de recogida"><input type="date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} className="app-input" /></Field>
              <Field label="Valor declarado (opcional)"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span><input type="number" min={0} step="any" value={declaredValue} onChange={(event) => setDeclaredValue(Number(event.target.value))} className="app-input pl-7" /></div></Field>
            </div>
            <div className="mt-5 flex justify-end"><Button type="button" onClick={quoteUps} disabled={quoting || !carrierStatus?.ups.configured} variant="primary" size="lg">{quoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}{quoting ? "Consultando tarifa..." : "Obtener cotización UPS"}</Button></div>
          </ModuleSection>
          <QuoteResults />
        </>
      ) : null}

      {view === "history" ? (
        <ModuleSection>
          <PageHeader title="Cotizaciones guardadas" copy="Registro de tarifas seleccionadas por el equipo." actions={<Button type="button" onClick={() => setView("ups")} variant="primary" size="md"><Plus className="h-4 w-4" />Nueva cotización</Button>} />
          <div className="mt-5 overflow-hidden rounded-lg border border-line">
            {visibleCalculations.length ? <div className="divide-y divide-line">{visibleCalculations.map((item) => {
              const metadata = item.metadata as { official?: boolean; quote?: CarrierQuote; environment?: string } | undefined;
              return <div key={item.id} className="grid min-w-0 gap-3 bg-panel p-4 md:grid-cols-[minmax(0,1fr)_180px_44px] md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-ink">{item.agente || "Transportista"} | {item.tipo_flete || "Servicio"}</span>{metadata?.official ? <StatusBadge tone="ok">Oficial</StatusBadge> : <StatusBadge tone="warn">Estimación anterior</StatusBadge>}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"><span>{item.created_at ? new Date(item.created_at).toLocaleString("es-PA") : "Sin fecha"}</span>{item.licitacion ? <span>RFQ {item.licitacion}{item.renglon ? ` | Renglón ${item.renglon}` : ""}</span> : null}{canManageLogistics && item.username ? <span>Usuario: {item.username}</span> : null}{metadata?.environment ? <span>{metadata.environment}</span> : null}</div></div><div className="md:text-right"><div className="text-xs text-muted">Total</div><div className="font-semibold text-ink">{money(Number(item.costo_total || 0), metadata?.quote?.currency)}</div>{item.tiempo_transito_dias ? <div className="mt-1 text-xs text-muted"><Clock3 className="mr-1 inline h-3.5 w-3.5" />{item.tiempo_transito_dias} día(s)</div> : null}</div><Button type="button" onClick={() => removeCalculation(item.id)} variant="danger" size="icon" aria-label="Borrar cotización" title="Borrar cotización"><Trash2 className="h-4 w-4" /></Button></div>;
            })}</div> : <div className="grid min-h-48 place-items-center bg-slate-50 p-6 text-center"><div><History className="mx-auto h-6 w-6 text-muted" /><div className="mt-3 text-sm font-semibold text-ink">Aún no hay cotizaciones</div><p className="mt-1 text-sm text-muted">Las tarifas oficiales seleccionadas aparecerán aquí.</p></div></div>}
          </div>
        </ModuleSection>
      ) : null}

      {view === "settings" && canManageLogistics ? (
        <div className="space-y-5">
          <ModuleSection>
            <PageHeader eyebrow="Solo Logística" title="Forwarders del equipo" copy="Estos destinos quedan disponibles para analistas, supervisores y gerencia." />
            {settingsSaved ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Forwarder guardado para todo el equipo.</div> : null}
            <form onSubmit={(event) => { event.preventDefault(); void saveForwarder(); }} className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] lg:items-end">
              <Field label="Nombre"><input required value={forwarderForm.nombre} onChange={(event) => setForwarderForm((current) => ({ ...current, nombre: event.target.value }))} className="app-input" placeholder="Forwarder" /></Field>
              <Field label="Dirección completa USA"><input required value={forwarderForm.direccion} onChange={(event) => setForwarderForm((current) => ({ ...current, direccion: event.target.value }))} className="app-input" placeholder="Calle, ciudad, estado y ZIP" /></Field>
              <Field label="Nota operativa"><input value={forwarderForm.observacion} onChange={(event) => setForwarderForm((current) => ({ ...current, observacion: event.target.value }))} className="app-input" placeholder="Horario, atención, referencia" /></Field>
              <Button type="submit" disabled={savingForwarder} variant="primary" size="lg">{savingForwarder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar</Button>
            </form>
          </ModuleSection>
          <ModuleSection>
            <div className="grid gap-3 lg:grid-cols-2">{forwarders.map((item) => <div key={item.id} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-line bg-slate-50 p-4"><div className="min-w-0"><div className="text-sm font-semibold text-ink">{item.nombre}</div><div className="mt-1 text-sm leading-5 text-muted">{item.direccion || "Sin dirección"}</div>{item.observacion ? <div className="mt-1 text-xs text-muted">{item.observacion}</div> : null}</div><Button type="button" onClick={() => setForwarderForm({ nombre: item.nombre, direccion: item.direccion || "", observacion: item.observacion || "", activo: item.activo !== false })} variant="ghost" size="icon" aria-label={`Editar ${item.nombre}`} title={`Editar ${item.nombre}`}><Pencil className="h-4 w-4" /></Button></div>)}</div>
          </ModuleSection>
        </div>
      ) : null}
    </div>
  );
}
