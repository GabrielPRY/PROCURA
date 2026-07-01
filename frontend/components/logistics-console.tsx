"use client";

import { Calculator, Info, Loader2, MapPin, PackageCheck, Plus, Ruler, Save, Scale, Settings, Trash2, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cleanValue, loadActiveRfqContext, loadLastRfq, type ActiveRfqItemContext, type RfqAnalysisResponse, type RfqItem } from "@/lib/rfq";
import { type AuthUser } from "@/lib/auth";
import {
  deleteLogisticsCalculation,
  getLogisticsCalculations,
  getLogisticsSettings,
  saveLogisticsCalculation,
  saveLogisticsForwarder,
  saveLogisticsFreightRate,
  saveLogisticsLocalRate,
  type Forwarder,
  type FreightRate,
  type Incoterm,
  type LocalRate,
  type LogisticsCalculation
} from "@/lib/logistics";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";

type LoadType = "Caja" | "Paquete" | "Bulto" | "Pallet" | "Crate" | "Tambor" | "Rollo";
type WeightUnit = "lb" | "kg";
type DimensionUnit = "in" | "cm" | "m";
type PalletPreset = "custom" | "us_48x40" | "eu_120x80" | "iso_120x100";

type PackageRow = {
  id: number;
  loadType: LoadType;
  quantity: number;
  weight: number;
  weightUnit: WeightUnit;
  length: number;
  width: number;
  height: number;
  dimensionUnit: DimensionUnit;
  palletPreset: PalletPreset;
  stackable: boolean;
  fragile: boolean;
  hazardous: boolean;
  oversized: boolean;
  refrigerated: boolean;
};

const loadTypes: LoadType[] = ["Caja", "Paquete", "Bulto", "Pallet", "Crate", "Tambor", "Rollo"];
const weightUnits: WeightUnit[] = ["lb", "kg"];
const dimensionUnits: DimensionUnit[] = ["in", "cm", "m"];
const palletPresets: { id: PalletPreset; label: string; length: number; width: number; unit: DimensionUnit }[] = [
  { id: "custom", label: "Personalizado", length: 0, width: 0, unit: "in" },
  { id: "us_48x40", label: "Pallet USA 48 x 40 in", length: 48, width: 40, unit: "in" },
  { id: "eu_120x80", label: "Pallet Euro 120 x 80 cm", length: 120, width: 80, unit: "cm" },
  { id: "iso_120x100", label: "Pallet ISO 120 x 100 cm", length: 120, width: 100, unit: "cm" }
];

function createPackageRow(id: number): PackageRow {
  return {
    id,
    loadType: "Caja",
    quantity: 1,
    weight: 10,
    weightUnit: "lb",
    length: 12,
    width: 12,
    height: 12,
    dimensionUnit: "in",
    palletPreset: "custom",
    stackable: true,
    fragile: false,
    hazardous: false,
    oversized: false,
    refrigerated: false
  };
}

const fallbackIncoterms = [
  ["EXW", "Proyelec asume casi toda la logistica desde origen."],
  ["FCA", "Proveedor entrega al transportista designado."],
  ["FOB", "Proveedor cubre hasta puerto de salida."],
  ["CIF", "Proveedor cubre flete y seguro hasta puerto destino."],
  ["DAP", "Proveedor entrega en destino acordado sin nacionalizacion."]
];

function itemLabel(item: RfqItem, index: number) {
  const renglon = cleanValue(item.renglon, String(index + 1));
  const code = cleanValue(item.codigo_articulo, "S/C");
  const desc = cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "Sin descripcion");
  return `Renglon ${renglon} | ${code} | ${desc.slice(0, 70)}`;
}

function toPounds(value: number, unit: WeightUnit) {
  return Math.max(0, value) * (unit === "kg" ? 2.20462 : 1);
}

function toInches(value: number, unit: DimensionUnit) {
  if (unit === "cm") return Math.max(0, value) / 2.54;
  if (unit === "m") return Math.max(0, value) * 39.3701;
  return Math.max(0, value);
}

function rowDimensionsIn(row: PackageRow) {
  return {
    length: toInches(row.length, row.dimensionUnit),
    width: toInches(row.width, row.dimensionUnit),
    height: toInches(row.height, row.dimensionUnit)
  };
}

function packageRealWeight(row: PackageRow) {
  return Math.max(0, row.quantity) * toPounds(row.weight, row.weightUnit);
}

function packageVolumetricWeight(row: PackageRow) {
  const dimensions = rowDimensionsIn(row);
  return (dimensions.length * dimensions.width * dimensions.height * Math.max(0, row.quantity)) / 166;
}

function packageChargeableWeight(row: PackageRow) {
  return Math.max(packageRealWeight(row), packageVolumetricWeight(row));
}

function packageCubicFeet(row: PackageRow) {
  const dimensions = rowDimensionsIn(row);
  return (dimensions.length * dimensions.width * dimensions.height * Math.max(0, row.quantity)) / 1728;
}

function specialHandlingLabels(row: PackageRow) {
  return [
    !row.stackable ? "No estibable" : "",
    row.fragile ? "Fragil" : "",
    row.hazardous ? "Hazmat" : "",
    row.oversized ? "Sobredimensionado" : "",
    row.refrigerated ? "Refrigerado" : ""
  ].filter(Boolean);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function StepHeader({ step, title, copy }: { step: string; title: string; copy: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-blue-200 bg-blue-50 text-sm font-black text-brand">
        {step}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block text-sm leading-6 text-muted">{copy}</span>
      </span>
    </div>
  );
}
function toNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function LogisticsConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [incoterm, setIncoterm] = useState("EXW");
  const [freightRates, setFreightRates] = useState<FreightRate[]>([]);
  const [forwarders, setForwarders] = useState<Forwarder[]>([]);
  const [localRates, setLocalRates] = useState<LocalRate[]>([]);
  const [incoterms, setIncoterms] = useState<Incoterm[]>([]);
  const [calculations, setCalculations] = useState<LogisticsCalculation[]>([]);
  const [selectedRateId, setSelectedRateId] = useState<number | "manual">("manual");
  const [origin, setOrigin] = useState("Miami, FL");
  const [destination, setDestination] = useState("Panama");
  const [transportMode, setTransportMode] = useState("Automatico");
  const [rate, setRate] = useState(3.75);
  const [handling, setHandling] = useState(35);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRfqContext, setActiveRfqContext] = useState<ActiveRfqItemContext | null>(null);
  const [packages, setPackages] = useState<PackageRow[]>([createPackageRow(1)]);
  const [savingSettings, setSavingSettings] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);
  const [freightForm, setFreightForm] = useState({
    agente: "",
    tipo_servicio: "USA-Panama",
    tipo_flete: "Aereo",
    tarifa_por_libra: 3.75,
    tiempo_transito_dias: 5,
    minimo_envio: 35,
    dia_corte: "",
    salidas: "",
    activo: true
  });
  const [forwarderForm, setForwarderForm] = useState({ nombre: "", direccion: "", observacion: "", activo: true });
  const [localRateForm, setLocalRateForm] = useState({
    agente: "",
    destino: "Panama",
    tipo_flete: "Terrestre",
    hasta_400kg: 0,
    kg_500_1000: 0,
    mayor_1000kg: 0,
    activo: true
  });

  useEffect(() => {
    const savedRfq = loadLastRfq(user.username);
    const context = loadActiveRfqContext(user.username);
    setRfq(savedRfq);
    setActiveRfqContext(context?.target_module === "logistica" ? context : null);
    if (savedRfq?.items?.length && context?.target_module === "logistica") {
      const nextIndex = Math.min(Math.max(Number(context.item_index) || 0, 0), savedRfq.items.length - 1);
      setSelectedIndex(nextIndex);
    }
  }, [user.username]);

  useEffect(() => {
    let mounted = true;
    setLoadingSettings(true);
    Promise.all([getLogisticsSettings(), getLogisticsCalculations(25)])
      .then(([settings, history]) => {
        if (!mounted) return;
        applyLogisticsSettings(settings);
        setCalculations(history.calculations || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar la configuracion logistica."))
      .finally(() => {
        if (mounted) setLoadingSettings(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const canManageLogistics = ["Logistica", "Admin"].includes(String(user.role || ""));

  function applyLogisticsSettings(settings: { freight_rates?: FreightRate[]; forwarders?: Forwarder[]; local_rates?: LocalRate[]; incoterms?: Incoterm[] }) {
    const activeRates = (settings.freight_rates || []).filter((item) => item.activo !== false);
    const activeForwarders = (settings.forwarders || []).filter((item) => item.activo !== false);
    const activeLocalRates = (settings.local_rates || []).filter((item) => item.activo !== false);
    setFreightRates(activeRates);
    setForwarders(activeForwarders);
    setLocalRates(activeLocalRates);
    setIncoterms(settings.incoterms || []);
    if (activeRates.length) {
      const firstRate = activeRates[0];
      if (selectedRateId === "manual") setSelectedRateId(firstRate.id);
      setRate(toNumber(firstRate.tarifa_por_libra, rate));
      setHandling(toNumber(firstRate.minimo_envio, handling));
      setFreightForm((current) => ({
        ...current,
        agente: firstRate.agente || current.agente,
        tipo_servicio: firstRate.tipo_servicio || current.tipo_servicio,
        tipo_flete: firstRate.tipo_flete || current.tipo_flete,
        tarifa_por_libra: toNumber(firstRate.tarifa_por_libra, current.tarifa_por_libra),
        tiempo_transito_dias: toNumber(firstRate.tiempo_transito_dias, current.tiempo_transito_dias),
        minimo_envio: toNumber(firstRate.minimo_envio, current.minimo_envio),
        dia_corte: firstRate.dia_corte || current.dia_corte,
        salidas: firstRate.salidas || current.salidas,
        activo: firstRate.activo !== false
      }));
    }
    if (activeForwarders.length) {
      const first = activeForwarders[0];
      setForwarderForm((current) => ({ ...current, nombre: first.nombre || current.nombre, direccion: first.direccion || current.direccion, observacion: first.observacion || current.observacion, activo: first.activo !== false }));
    }
    if (activeLocalRates.length) {
      const first = activeLocalRates[0];
      setLocalRateForm((current) => ({
        ...current,
        agente: first.agente || current.agente,
        destino: first.destino || current.destino,
        tipo_flete: first.tipo_flete || current.tipo_flete,
        hasta_400kg: toNumber(first.hasta_400kg, current.hasta_400kg),
        kg_500_1000: toNumber(first.kg_500_1000, current.kg_500_1000),
        mayor_1000kg: toNumber(first.mayor_1000kg, current.mayor_1000kg),
        activo: first.activo !== false
      }));
    }
    if (settings.incoterms?.length) setIncoterm(settings.incoterms[0].sigla);
  }

  async function refreshSettingsOnly() {
    const settings = await getLogisticsSettings();
    applyLogisticsSettings(settings);
  }

  async function saveFreightSettings() {
    setError(null);
    setSettingsSaved(null);
    setSavingSettings("freight");
    try {
      await saveLogisticsFreightRate(freightForm);
      await refreshSettingsOnly();
      setSettingsSaved("Tarifa internacional actualizada para todos los usuarios.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la tarifa internacional.");
    } finally {
      setSavingSettings(null);
    }
  }

  async function saveForwarderSettings() {
    setError(null);
    setSettingsSaved(null);
    setSavingSettings("forwarder");
    try {
      await saveLogisticsForwarder(forwarderForm);
      await refreshSettingsOnly();
      setSettingsSaved("Forwarder/localidad actualizado para todos los usuarios.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el forwarder.");
    } finally {
      setSavingSettings(null);
    }
  }

  async function saveLocalRateSettings() {
    setError(null);
    setSettingsSaved(null);
    setSavingSettings("local");
    try {
      await saveLogisticsLocalRate(localRateForm);
      await refreshSettingsOnly();
      setSettingsSaved("Tarifa local actualizada para todos los usuarios.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la tarifa local.");
    } finally {
      setSavingSettings(null);
    }
  }
  const items = useMemo(() => rfq?.items || [], [rfq]);
  const selectedItem = items[selectedIndex];
  const selectedRate = freightRates.find((item) => item.id === selectedRateId);
  const realWeight = packages.reduce((sum, row) => sum + packageRealWeight(row), 0);
  const volumetricWeight = packages.reduce((sum, row) => sum + packageVolumetricWeight(row), 0);
  const chargeableWeight = packages.reduce((sum, row) => sum + packageChargeableWeight(row), 0);
  const totalVolumeFt3 = packages.reduce((sum, row) => sum + packageCubicFeet(row), 0);
  const specialHandling = Array.from(new Set(packages.flatMap((row) => specialHandlingLabels(row))));
  const hasPallets = packages.some((row) => row.loadType === "Pallet");
  const requiresForwarderReview = specialHandling.length > 0 || chargeableWeight > 800 || totalVolumeFt3 > 80;
  const recommendedMode = transportMode !== "Automatico"
    ? transportMode
    : requiresForwarderReview
      ? "Validar con forwarder"
      : chargeableWeight <= 150 && totalVolumeFt3 <= 15
        ? "Courier / aereo rapido"
        : chargeableWeight <= 800
          ? "Aereo consolidado"
          : "Maritimo LCL";
  const logisticsRisk = requiresForwarderReview ? "Requiere validacion" : volumetricWeight > realWeight * 1.4 ? "Volumetrico alto" : "Normal";
  const estimatedCost = chargeableWeight * rate + handling;
  const internationalCost = chargeableWeight * rate;
  const selectedIncoterm = incoterms.find((item) => item.sigla === incoterm);
  const fallbackIncoterm = fallbackIncoterms.find(([code]) => code === incoterm);
  const incotermResponsibilities = selectedIncoterm?.responsabilidades && typeof selectedIncoterm.responsabilidades === "object"
    ? Object.entries(selectedIncoterm.responsabilidades)
    : [];
  const licitacion = cleanValue(rfq?.condiciones_generales?.numero_licitacion, "");
  const renglon = cleanValue(selectedItem?.renglon, "");
  const operationalSummary = [
    `Ruta: ${origin || "Origen no definido"} a ${destination || "Destino no definido"}`,
    `Modo sugerido: ${recommendedMode}`,
    `Riesgo logistico: ${logisticsRisk}`,
    `Forwarder/tarifa: ${selectedRate?.agente || "Manual"} ${selectedRate?.tipo_flete ? `(${selectedRate.tipo_flete})` : ""}`,
    `Incoterm: ${incoterm}`,
    `Piezas: ${packages.reduce((sum, row) => sum + Math.max(0, row.quantity), 0)}${hasPallets ? " | Incluye pallet(s)" : ""}`,
    `Volumen: ${totalVolumeFt3.toFixed(2)} ft3`,
    `Peso real: ${realWeight.toFixed(2)} lb`,
    `Peso volumetrico: ${volumetricWeight.toFixed(2)} lb`,
    `Peso cobrable: ${chargeableWeight.toFixed(2)} lb`,
    specialHandling.length ? `Manejo especial: ${specialHandling.join(", ")}` : "Manejo especial: No reportado",
    `Costo internacional: ${money(internationalCost)}`,
    `Manejo/local: ${money(handling)}`,
    `Total estimado: ${money(estimatedCost)}`,
    selectedRate?.tiempo_transito_dias ? `Transito estimado: ${selectedRate.tiempo_transito_dias} dias` : ""
  ].filter(Boolean).join("\n");
  const totalPieces = packages.reduce((sum, row) => sum + Math.max(0, row.quantity), 0);
  const chargeBasis = volumetricWeight > realWeight ? "Volumetrico" : "Real";
  const costPerChargeableLb = chargeableWeight > 0 ? estimatedCost / chargeableWeight : 0;
  const selectedRenglon = selectedItem ? cleanValue(selectedItem.renglon, String(selectedIndex + 1)) : "Manual";
  const selectedCode = selectedItem ? cleanValue(selectedItem.codigo_articulo, "S/C") : "S/C";
  const selectedDescription = selectedItem
    ? cleanValue(selectedItem.termino_de_busqueda_corto || selectedItem.descripcion || selectedItem.ficha_tecnica_completa, "Sin descripcion")
    : "Sin renglon conectado.";

  function updatePackage(id: number, patch: Partial<PackageRow>) {
    setPackages((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addPackage() {
    setPackages((current) => [...current, createPackageRow(Date.now())]);
  }

  function applyPalletPreset(id: number, presetId: PalletPreset) {
    const preset = palletPresets.find((item) => item.id === presetId);
    if (!preset || preset.id === "custom") {
      updatePackage(id, { palletPreset: presetId, loadType: presetId === "custom" ? "Pallet" : undefined } as Partial<PackageRow>);
      return;
    }
    updatePackage(id, {
      loadType: "Pallet",
      palletPreset: preset.id,
      length: preset.length,
      width: preset.width,
      dimensionUnit: preset.unit
    });
  }

  function removePackage(id: number) {
    setPackages((current) => (current.length === 1 ? current : current.filter((row) => row.id !== id)));
  }

  function handleRateChange(value: string) {
    if (value === "manual") {
      setSelectedRateId("manual");
      return;
    }
    const id = Number(value);
    const nextRate = freightRates.find((item) => item.id === id);
    setSelectedRateId(id);
    if (nextRate) {
      setRate(toNumber(nextRate.tarifa_por_libra, rate));
      setHandling(toNumber(nextRate.minimo_envio, handling));
    }
  }

  async function saveCalculation() {
    setError(null);
    setSaving(true);
    try {
      await saveLogisticsCalculation({
        username: user.username,
        licitacion,
        renglon,
        agente: selectedRate?.agente || "Manual",
        tipo_flete: selectedRate?.tipo_flete || "Manual",
        incoterm,
        peso_libras: realWeight,
        peso_kg: realWeight * 0.453592,
        costo_internacional: chargeableWeight * rate,
        costo_local: handling,
        costo_total: estimatedCost,
        tiempo_transito_dias: selectedRate?.tiempo_transito_dias || 0,
        peso_facturable_libras: chargeableWeight,
        peso_volumetrico_libras: volumetricWeight,
        largo: packages[0] ? rowDimensionsIn(packages[0]).length : 0,
        ancho: packages[0] ? rowDimensionsIn(packages[0]).width : 0,
        alto: packages[0] ? rowDimensionsIn(packages[0]).height : 0,
        unidad_dimensional: "in",
        metadata: {
          packages,
          ruta: `${origin}-${destination}`,
          origin,
          destination,
          transportMode,
          recommendedMode,
          logisticsRisk,
          specialHandling,
          totalVolumeFt3,
          source: "frontend-next"
        }
      });
      const history = await getLogisticsCalculations(25);
      setCalculations(history.calculations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el calculo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCalculation(id: number) {
    setError(null);
    try {
      await deleteLogisticsCalculation(id);
      setCalculations((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el calculo.");
    }
  }

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Logistica USA a Panama"
          title="Calculadora de costo logistico"
          copy="Calcula por paquete, caja, bulto o pallet usando peso real contra peso volumetrico. El resultado es referencial y debe validarse con Logistica antes de cotizar."
          actions={
            <>
              <StatusBadge tone={items.length ? "ok" : "neutral"}>{items.length ? "RFQ conectado" : "Modo manual"}</StatusBadge>
              <Button type="button" onClick={saveCalculation} disabled={saving} variant="primary" size="lg">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar calculo
              </Button>
            </>
          }
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total estimado" value={money(estimatedCost)} hint={"Flete " + money(internationalCost) + " + manejo " + money(handling)} icon={Calculator} />
          <StatCard label="Peso cobrable" value={chargeableWeight.toFixed(2) + " lb"} hint={"Base " + chargeBasis.toLowerCase()} icon={Scale} />
          <StatCard label="Piezas" value={totalPieces} hint={totalVolumeFt3.toFixed(2) + " ft3 total"} icon={PackageCheck} />
          <StatCard label="Modo sugerido" value={recommendedMode} hint={logisticsRisk} icon={Truck} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Renglon / codigo</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">{selectedRenglon} | {selectedCode}</div>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Forwarder</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">{selectedRate?.agente || "Manual"}</div>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Ruta</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">{origin || "Origen"} a {destination || "Destino"}</div>
          </div>
        </div>
      </ModuleSection>

      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}
      {loadingSettings && (
        <section className="flex items-center gap-2 rounded-xl border border-line bg-panel p-4 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando tarifas, incoterms e historial logistico...
        </section>
      )}

      {settingsSaved ? <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{settingsSaved}</section> : null}

      {canManageLogistics ? (
        <ModuleSection>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Settings className="h-4 w-4 text-brand" />
                Valores logísticos que usan todos
              </div>
              <p className="mt-1 text-sm leading-6 text-muted">
                Esta zona es solo para Logística/Admin. Las tarifas guardadas aquí alimentan la calculadora de analistas, supervisores y gerencia.
              </p>
            </div>
            <StatusBadge tone="info">Editable por Logística</StatusBadge>
          </div>

          <div className="mt-5 grid gap-4 2xl:grid-cols-3">
            <div className="rounded-xl border border-line bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Tarifa internacional</div>
              <p className="mt-1 text-xs leading-5 text-muted">Forwarder, modo, costo por libra cobrable y mínimo de envío.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Forwarder / agente<input value={freightForm.agente} onChange={(event) => setFreightForm((current) => ({ ...current, agente: event.target.value }))} className="app-input" placeholder="Ej: Miami Forwarder" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Servicio<input value={freightForm.tipo_servicio} onChange={(event) => setFreightForm((current) => ({ ...current, tipo_servicio: event.target.value }))} className="app-input" placeholder="USA-Panama" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Tipo de flete<input value={freightForm.tipo_flete} onChange={(event) => setFreightForm((current) => ({ ...current, tipo_flete: event.target.value }))} className="app-input" placeholder="Aéreo / Marítimo" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">USD/lb cobrable<input type="number" value={freightForm.tarifa_por_libra} min={0} step={0.01} onChange={(event) => setFreightForm((current) => ({ ...current, tarifa_por_libra: Number(event.target.value) }))} className="app-input" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Mínimo USD<input type="number" value={freightForm.minimo_envio} min={0} step={1} onChange={(event) => setFreightForm((current) => ({ ...current, minimo_envio: Number(event.target.value) }))} className="app-input" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Tránsito días<input type="number" value={freightForm.tiempo_transito_dias} min={0} step={1} onChange={(event) => setFreightForm((current) => ({ ...current, tiempo_transito_dias: Number(event.target.value) }))} className="app-input" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Día de corte<input value={freightForm.dia_corte} onChange={(event) => setFreightForm((current) => ({ ...current, dia_corte: event.target.value }))} className="app-input" placeholder="Viernes 12:00" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Salidas<input value={freightForm.salidas} onChange={(event) => setFreightForm((current) => ({ ...current, salidas: event.target.value }))} className="app-input" placeholder="Semanal / diario" /></label>
              </div>
              <Button type="button" onClick={saveFreightSettings} disabled={savingSettings === "freight"} variant="primary" size="md" className="mt-4 w-full">{savingSettings === "freight" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar tarifa internacional</Button>
            </div>

            <div className="rounded-xl border border-line bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Forwarder y localidad</div>
              <p className="mt-1 text-xs leading-5 text-muted">Dirección operativa y notas que verán los usuarios al calcular.</p>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Nombre<input value={forwarderForm.nombre} onChange={(event) => setForwarderForm((current) => ({ ...current, nombre: event.target.value }))} className="app-input" placeholder="Ej: Bodega Miami" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Dirección / localidad<input value={forwarderForm.direccion} onChange={(event) => setForwarderForm((current) => ({ ...current, direccion: event.target.value }))} className="app-input" placeholder="Miami, FL" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Observación<textarea value={forwarderForm.observacion} onChange={(event) => setForwarderForm((current) => ({ ...current, observacion: event.target.value }))} className="min-h-24 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100" placeholder="Horario, contacto, restricción o nota operativa" /></label>
              </div>
              <Button type="button" onClick={saveForwarderSettings} disabled={savingSettings === "forwarder"} variant="primary" size="md" className="mt-4 w-full">{savingSettings === "forwarder" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar forwarder</Button>
            </div>

            <div className="rounded-xl border border-line bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Tarifa local Panamá</div>
              <p className="mt-1 text-xs leading-5 text-muted">Referencias locales por destino y rango de peso.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Agente local<input value={localRateForm.agente} onChange={(event) => setLocalRateForm((current) => ({ ...current, agente: event.target.value }))} className="app-input" placeholder="Ej: Transporte local" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Destino<input value={localRateForm.destino} onChange={(event) => setLocalRateForm((current) => ({ ...current, destino: event.target.value }))} className="app-input" placeholder="Panamá / Corozal" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Tipo<input value={localRateForm.tipo_flete} onChange={(event) => setLocalRateForm((current) => ({ ...current, tipo_flete: event.target.value }))} className="app-input" placeholder="Terrestre" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Hasta 400kg<input type="number" value={localRateForm.hasta_400kg} min={0} step={1} onChange={(event) => setLocalRateForm((current) => ({ ...current, hasta_400kg: Number(event.target.value) }))} className="app-input" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">500-1000kg<input type="number" value={localRateForm.kg_500_1000} min={0} step={1} onChange={(event) => setLocalRateForm((current) => ({ ...current, kg_500_1000: Number(event.target.value) }))} className="app-input" /></label>
                <label className="grid gap-1 text-xs font-semibold text-slate-700">Mayor 1000kg<input type="number" value={localRateForm.mayor_1000kg} min={0} step={1} onChange={(event) => setLocalRateForm((current) => ({ ...current, mayor_1000kg: Number(event.target.value) }))} className="app-input" /></label>
              </div>
              <Button type="button" onClick={saveLocalRateSettings} disabled={savingSettings === "local"} variant="primary" size="md" className="mt-4 w-full">{savingSettings === "local" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar tarifa local</Button>
            </div>
          </div>
        </ModuleSection>
      ) : null}
      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <StepHeader step="1" title="Ruta y tarifa" copy="Selecciona el renglon, forwarder, incoterm y ruta operativa. Por ahora el flujo esta calibrado para USA a Panama." />
              {activeRfqContext ? (
                <div className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                  Renglon recibido desde RFQ
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {items.length > 0 ? (
                <label className="grid gap-2 text-sm font-semibold text-slate-800 lg:col-span-2">
                  Renglon relacionado
                  <select
                    value={selectedIndex}
                    onChange={(event) => setSelectedIndex(Number(event.target.value))}
                    className="app-input"
                  >
                    {items.map((item, index) => (
                      <option key={`${item.renglon}-${index}`} value={index}>
                        {itemLabel(item, index)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="rounded-xl border border-line bg-slate-50 p-4 lg:col-span-2">
                <div className="grid gap-3 md:grid-cols-[140px_140px_1fr]">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Renglon</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{selectedRenglon}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Codigo ACP</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{selectedCode}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Descripcion</div>
                    <div className="mt-1 line-clamp-2 text-sm leading-5 text-slate-700">{selectedDescription}</div>
                  </div>
                </div>
              </div>

              <label className="grid gap-2 text-sm font-semibold text-slate-800 lg:col-span-2">
                Tarifa / forwarder
                <select
                  value={String(selectedRateId)}
                  onChange={(event) => handleRateChange(event.target.value)}
                  className="app-input"
                >
                  <option value="manual">Manual</option>
                  {freightRates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.agente} | {item.tipo_flete} | ${toNumber(item.tarifa_por_libra).toFixed(2)}/lb | min ${toNumber(item.minimo_envio).toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Incoterm
                <select
                  value={incoterm}
                  onChange={(event) => setIncoterm(event.target.value)}
                  className="app-input"
                >
                  {(incoterms.length ? incoterms : fallbackIncoterms.map(([sigla, notas]) => ({ sigla, notas }))).map((item) => (
                    <option key={item.sigla} value={item.sigla}>
                      {item.sigla}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Tarifa USD/lb cobrable
                <input
                  type="number"
                  value={rate}
                  min={0}
                  step={0.05}
                  onChange={(event) => setRate(Number(event.target.value))}
                  className="app-input"
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Origen operativo
                <input
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                  className="app-input"
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Destino
                <input
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  className="app-input"
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-slate-800 lg:col-span-2">
                Modo de transporte
                <select
                  value={transportMode}
                  onChange={(event) => setTransportMode(event.target.value)}
                  className="app-input"
                >
                  <option value="Automatico">Automatico segun peso/volumen</option>
                  <option value="Courier / aereo rapido">Courier / aereo rapido</option>
                  <option value="Aereo consolidado">Aereo consolidado</option>
                  <option value="Maritimo LCL">Maritimo LCL</option>
                  <option value="Validar con forwarder">Validar con forwarder</option>
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <StepHeader step="2" title="Paquetes y dimensiones" copy="Agrega cajas, bultos o pallets. El sistema compara peso real contra peso volumetrico y define la base cobrable." />
              <Button type="button" onClick={addPackage} variant="primary" size="md">
                <Plus className="h-3.5 w-3.5" />
                Agregar carga
              </Button>
            </div>

            <div className="mt-4 grid gap-4">
              {packages.map((row, index) => {
                const rowSpecial = specialHandlingLabels(row);
                return (
                  <div key={row.id} className="rounded-xl border border-line bg-white p-4 shadow-sm ring-1 ring-transparent">
                    <div className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <PackageCheck className="h-4 w-4 text-brand" />
                        Carga {index + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() => removePackage(row.id)}
                        disabled={packages.length === 1}
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 text-xs font-semibold text-rose-700 disabled:border-line disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Borrar
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                      <label className="grid gap-1 text-xs font-semibold text-slate-700">
                        Tipo de carga
                        <select
                          value={row.loadType}
                          onChange={(event) => updatePackage(row.id, { loadType: event.target.value as LoadType })}
                          className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                        >
                          {loadTypes.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-700">
                        Cantidad
                        <input
                          type="number"
                          value={row.quantity}
                          min={0}
                          step={1}
                          onChange={(event) => updatePackage(row.id, { quantity: Number(event.target.value) })}
                          className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-700">
                        Peso por unidad
                        <div className="grid grid-cols-[1fr_74px] gap-2">
                          <input
                            type="number"
                            value={row.weight}
                            min={0}
                            step={0.1}
                            onChange={(event) => updatePackage(row.id, { weight: Number(event.target.value) })}
                            className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                          />
                          <select
                            value={row.weightUnit}
                            onChange={(event) => updatePackage(row.id, { weightUnit: event.target.value as WeightUnit })}
                            className="h-10 rounded-lg border border-line bg-white px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                          >
                            {weightUnits.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </div>
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-700">
                        Unidad dimensional
                        <select
                          value={row.dimensionUnit}
                          onChange={(event) => updatePackage(row.id, { dimensionUnit: event.target.value as DimensionUnit })}
                          className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                        >
                          {dimensionUnits.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </label>

                      {row.loadType === "Pallet" ? (
                        <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2 2xl:col-span-4">
                          Tipo de pallet
                          <select
                            value={row.palletPreset}
                            onChange={(event) => applyPalletPreset(row.id, event.target.value as PalletPreset)}
                            className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                          >
                            {palletPresets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                          </select>
                        </label>
                      ) : null}

                      {["length", "width", "height"].map((key) => (
                        <label key={key} className="grid gap-1 text-xs font-semibold text-slate-700">
                          {key === "length" ? "Largo" : key === "width" ? "Ancho" : "Alto"}
                          <input
                            type="number"
                            value={Number(row[key as keyof PackageRow])}
                            min={0}
                            step={0.1}
                            onChange={(event) => updatePackage(row.id, { [key]: Number(event.target.value) } as Partial<PackageRow>)}
                            className="h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                          />
                        </label>
                      ))}

                      <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 text-xs font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={row.stackable}
                          onChange={(event) => updatePackage(row.id, { stackable: event.target.checked })}
                          className="h-4 w-4 rounded border-line text-brand focus:ring-blue-100"
                        />
                        Estibable
                      </label>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      {[
                        ["fragile", "Fragil"],
                        ["hazardous", "Material peligroso"],
                        ["oversized", "Sobredimensionado"],
                        ["refrigerated", "Refrigerado"]
                      ].map(([key, label]) => (
                        <label key={key} className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(row[key as keyof PackageRow])}
                            onChange={(event) => updatePackage(row.id, { [key]: event.target.checked } as Partial<PackageRow>)}
                            className="h-4 w-4 rounded border-line text-brand focus:ring-blue-100"
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <div className="app-data-card">
                        <div className="text-xs text-muted">Peso real</div>
                        <div className="mt-1 font-semibold text-slate-900">{packageRealWeight(row).toFixed(2)} lb</div>
                      </div>
                      <div className="app-data-card">
                        <div className="text-xs text-muted">Volumetrico</div>
                        <div className="mt-1 font-semibold text-slate-900">{packageVolumetricWeight(row).toFixed(2)} lb</div>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <div className="text-xs text-blue-700">Cobrable</div>
                        <div className="mt-1 font-semibold text-slate-950">{packageChargeableWeight(row).toFixed(2)} lb</div>
                      </div>
                      <div className="app-data-card">
                        <div className="text-xs text-muted">Volumen</div>
                        <div className="mt-1 font-semibold text-slate-900">{packageCubicFeet(row).toFixed(2)} ft3</div>
                      </div>
                    </div>
                    {rowSpecial.length ? (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        Requiere atencion: {rowSpecial.join(", ")}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="app-data-card">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <Scale className="h-3.5 w-3.5" />
                  Peso real
                </div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{realWeight.toFixed(2)} lb</div>
              </div>
              <div className="app-data-card">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <Ruler className="h-3.5 w-3.5" />
                  Volumetrico
                </div>
                <div className="mt-1 text-xl font-semibold text-slate-900">{volumetricWeight.toFixed(2)} lb</div>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
                  <Calculator className="h-3.5 w-3.5" />
                  Cobrable
                </div>
                <div className="mt-1 text-xl font-semibold text-slate-950">{chargeableWeight.toFixed(2)} lb</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Modo sugerido</div>
                <div className="mt-1 text-sm font-semibold text-slate-950">{recommendedMode}</div>
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-5 2xl:sticky 2xl:top-4 2xl:self-start">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Calculator className="h-4 w-4 text-brand" />
              Resultado
            </div>
            <div className="mt-4 rounded-xl border border-blue-100 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Costo total estimado</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{money(estimatedCost)}</div>
              <div className="mt-1 text-xs text-slate-600">Base {chargeBasis.toLowerCase()} | {chargeableWeight.toFixed(2)} lb cobrables</div>
            </div>
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-white/75 px-3 py-2">
                <span className="text-slate-600">Flete internacional</span>
                <span className="font-semibold text-slate-900">{money(internationalCost)}</span>
              </div>
              <label className="grid gap-2 rounded-lg bg-white/75 px-3 py-2 text-sm font-semibold text-slate-800">
                Manejo/local USD
                <input
                  type="number"
                  value={handling}
                  min={0}
                  step={1}
                  onChange={(event) => setHandling(Number(event.target.value))}
                  className="h-10 rounded-lg border border-blue-100 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <div className="flex items-center justify-between rounded-lg bg-white/75 px-3 py-2">
                <span className="text-slate-600">Tarifa aplicada</span>
                <span className="font-semibold text-slate-900">{money(rate)} / lb</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MapPin className="h-4 w-4 text-brand" />
              Tarifa seleccionada
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-700">
              <div className="app-data-card">
                <div className="font-semibold text-slate-950">{selectedRate?.agente || "Manual"}</div>
                <div className="mt-1 text-xs text-muted">{selectedRate?.tipo_servicio || selectedRate?.tipo_flete || "Tarifa ingresada manualmente"}</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
                <div className="app-data-card">Corte: {selectedRate?.dia_corte || "N/D"}</div>
                <div className="app-data-card">Salidas: {selectedRate?.salidas || "N/D"}</div>
              </div>
              <div className="app-data-card">
                Transito estimado: {selectedRate?.tiempo_transito_dias || "N/D"} dias
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Info className="h-4 w-4 text-brand" />
              {selectedIncoterm?.sigla || fallbackIncoterm?.[0] || incoterm}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{selectedIncoterm?.notas || fallbackIncoterm?.[1]}</p>
            {selectedIncoterm?.incoterm ? <p className="mt-2 text-sm font-semibold leading-6 text-slate-900">{selectedIncoterm.incoterm}</p> : null}
            {incotermResponsibilities.length ? (
              <div className="mt-3 grid gap-2 text-sm">
                {incotermResponsibilities.map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-line bg-slate-50 px-3 py-2">
                    <span className="font-semibold text-slate-900">{key}: </span>
                    <span className="text-slate-700">{String(value)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </aside>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Resumen para expediente</div>
          <p className="mt-1 text-sm text-muted">Texto limpio para copiar al expediente o usar como referencia interna.</p>
          <textarea
            readOnly
            value={operationalSummary}
            className="mt-3 min-h-44 w-full rounded-lg border border-line bg-slate-50 px-3 py-3 font-mono text-xs leading-5 text-slate-800 outline-none"
          />
        </div>

        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Calculos guardados</div>
          <p className="mt-1 text-sm text-muted">Historial real guardado para reutilizar estimaciones.</p>
          <div className="mt-4 overflow-hidden rounded-lg border border-line">
            {calculations.length ? (
              <div className="max-h-[360px] divide-y divide-line overflow-y-auto">
                {calculations.map((item) => (
                  <div key={item.id} className="grid gap-3 bg-white p-4 lg:grid-cols-[1fr_0.55fr_auto] lg:items-center">
                    <div>
                      <div className="font-semibold text-slate-900">{item.licitacion || "Sin licitacion"} | Renglon {item.renglon || "N/D"}</div>
                      <div className="mt-1 text-xs text-muted">
                        {item.created_at ? new Date(item.created_at).toLocaleString() : "Sin fecha"} | {item.agente || "Manual"} | {item.incoterm || "N/D"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-950">{money(toNumber(item.costo_total))}</div>
                    <button
                      type="button"
                      onClick={() => deleteCalculation(item.id)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Borrar
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 p-5 text-sm text-muted">Todavia no hay calculos guardados.</div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 2xl:grid-cols-2">
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Forwarders y localidades</div>
          <p className="mt-1 text-sm text-muted">Referencia visible de la ruta operativa actual.</p>
          <div className="mt-4 grid gap-3">
            {forwarders.length ? forwarders.slice(0, 6).map((item) => (
              <div key={item.id} className="app-data-card bg-white">
                <div className="font-semibold text-slate-900">{item.nombre}</div>
                <div className="mt-1 text-sm text-muted">{item.direccion || "Direccion no registrada"}</div>
                {item.observacion ? <div className="mt-1 text-xs text-slate-600">{item.observacion}</div> : null}
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-muted">No hay forwarders registrados.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Tarifas locales visibles</div>
          <p className="mt-1 text-sm text-muted">Referencia interna para validar manejo local cuando aplique.</p>
          <div className="mt-4 overflow-hidden rounded-lg border border-line">
            {localRates.length ? (
              <div className="divide-y divide-line">
                {localRates.slice(0, 6).map((item) => (
                  <div key={item.id} className="grid gap-2 bg-white p-3 text-sm sm:grid-cols-[1fr_0.8fr_0.8fr]">
                    <div>
                      <div className="font-semibold text-slate-900">{item.agente}</div>
                      <div className="text-xs text-muted">{item.destino || "Destino no registrado"}</div>
                    </div>
                    <div>Hasta 400kg: {money(toNumber(item.hasta_400kg))}</div>
                    <div>+1000kg: {money(toNumber(item.mayor_1000kg))}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 p-4 text-sm text-muted">No hay tarifas locales registradas.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}







