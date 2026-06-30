"use client";

import {
  CalendarClock,
  CheckCircle2,
  Clipboard,
  Download,
  FileText,
  Loader2,
  Mail,
  PackageCheck,
  PencilLine,
  Send,
  ShieldCheck,
  Wand2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type AuthUser } from "@/lib/auth";
import { asBool, cleanValue, loadActiveRfqContext, loadLastRfq, type ActiveRfqItemContext, type RfqAnalysisResponse, type RfqItem } from "@/lib/rfq";
import { emailHtml, generateRfqEmail } from "@/lib/rfq-email";
import { Button } from "@/components/ui/button";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";

function itemLabel(item: RfqItem, index: number) {
  return `Renglón ${cleanValue(item.renglon, String(index + 1))} | ${cleanValue(item.codigo_articulo, "S/C")} | ${cleanValue(
    item.termino_de_busqueda_corto || item.descripcion,
    "Sin descripción"
  ).slice(0, 78)}`;
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function getCg(cg: Record<string, unknown>, keys: string[], fallback = "No especificado") {
  for (const key of keys) {
    const value = cleanValue(cg[key], "");
    if (value) return value;
  }
  return fallback;
}

function metricTone(value: boolean) {
  return value ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700";
}

function buildSupplierChecklist(items: RfqItem[], leadTime: string, payment: string) {
  const hasProposal = items.some((item) => asBool(item.requiere_propuesta_tecnica));
  const hasFicha = items.some((item) => asBool(item.requiere_ficha_tecnica));
  const hasBrand = items.some((item) => cleanValue(item.marca_modelo_requerido, ""));
  return [
    ["Unit price and currency", true],
    ["Best project price / discount", true],
    ["Stock availability", true],
    [`Lead time confirmation: ${leadTime}`, true],
    [`Payment terms requested: ${payment}`, true],
    ["Incoterm EXW/FOB and country of origin", true],
    ["Packing dimensions, weight and volume", true],
    ["Warranty confirmation", true],
    ["Datasheet / catalog required", hasFicha],
    ["Technical proposal support", hasProposal],
    ["Brand / model restriction review", hasBrand]
  ] as Array<[string, boolean]>;
}

function emailBlocks(body: string) {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function RfqEmailConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [scope, setScope] = useState("all");
  const [language, setLanguage] = useState("English");
  const [payment, setPayment] = useState("Net 30 o superior");
  const [replyBy, setReplyBy] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [view, setView] = useState<"preview" | "edit">("preview");
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRfqContext, setActiveRfqContext] = useState<ActiveRfqItemContext | null>(null);

  useEffect(() => {
    const savedRfq = loadLastRfq(user.username);
    const context = loadActiveRfqContext(user.username);
    setRfq(savedRfq);
    setActiveRfqContext(context?.target_module === "rfq_email" ? context : null);
    if (savedRfq?.items?.length && context?.target_module === "rfq_email") {
      const nextIndex = Math.min(Math.max(Number(context.item_index) || 0, 0), savedRfq.items.length - 1);
      setScope(String(nextIndex));
    }
  }, [user.username]);

  const cg = (rfq?.condiciones_generales || {}) as Record<string, unknown>;
  const items = useMemo(() => rfq?.items || [], [rfq]);
  const selectedItems = scope === "all" ? items : items.filter((_, index) => String(index) === scope);
  const licitacion = getCg(cg, ["numero_licitacion", "licitacion", "rfq_id"], "RFQ");
  const leadTime = getCg(cg, ["tiempo_de_entrega_global", "tiempo_entrega", "plazo_entrega"], "N/A");
  const warranty = getCg(cg, ["garantia_exigida", "garantia", "garantia_requerida"], "N/A");
  const delivery = getCg(cg, ["lugar_de_entrega", "lugar_entrega", "entrega"], "N/A");
  const validity = getCg(cg, ["validez_de_la_oferta", "validez_oferta", "validez"], "N/A");
  const checklist = buildSupplierChecklist(selectedItems, leadTime, payment);
  const proposalCount = selectedItems.filter((item) => asBool(item.requiere_propuesta_tecnica)).length;
  const fichaCount = selectedItems.filter((item) => asBool(item.requiere_ficha_tecnica)).length;
  const brandCount = selectedItems.filter((item) => cleanValue(item.marca_modelo_requerido, "")).length;
  const blocks = emailBlocks(body);

  async function generate() {
    setError(null);
    setCopied(null);
    setLoading(true);
    try {
      const response = await generateRfqEmail({
        username: user.username,
        cg,
        items: selectedItems as Array<Record<string, unknown>>,
        language,
        contact_name: "",
        company: "",
        scope_label: scope === "all" ? "Todos los renglones" : itemLabel(items[Number(scope)], Number(scope)),
        payment_terms: payment,
        reply_by: replyBy,
        lead_time: leadTime
      });
      setSubject(response.subject);
      setBody(response.body);
      setView("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el RFQ.");
    } finally {
      setLoading(false);
    }
  }

  async function copyText(label: string, text: string) {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  const copyReadyEmail = subject ? `Subject: ${subject}\n\n${body}` : body;
  const html = emailHtml(subject || "Request for Quotation", body, [
    ["Bid", licitacion],
    ["Reply by", replyBy || "Pending"],
    ["Lead time", leadTime],
    ["Payment", payment],
    ["Warranty", warranty]
  ]);

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Correo RFQ premium"
          title="Solicitud profesional para proveedores"
          copy="Prepara un correo claro, humano y fácil de copiar a Outlook. La estructura pide precio, cumplimiento técnico, lead time, garantía, empaque, Incoterm y pago."
          actions={
            <>
              <StatusBadge tone="info">RFQ: {licitacion}</StatusBadge>
              <Button type="button" onClick={generate} disabled={!items.length || loading} variant="primary" size="lg">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Generar correo
              </Button>
            </>
          }
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Items" value={selectedItems.length} hint="Renglones incluidos" icon={FileText} />
          <StatCard label="Fichas" value={fichaCount} hint="Datasheet/catálogo" icon={CheckCircle2} />
          <StatCard label="Propuesta" value={proposalCount} hint="Soporte técnico" icon={ShieldCheck} />
          <StatCard label="Marca" value={brandCount} hint="Restricciones/modelos" icon={Mail} />
        </div>
      </ModuleSection>

      {!items.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Analiza primero un RFQ o abre un workspace guardado para que el correo salga con contexto real.
        </section>
      ) : null}
      {error ? <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section> : null}

      {activeRfqContext ? (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="font-semibold">Renglón recibido desde RFQ</div>
          <p className="mt-1 leading-6">
            Renglón {activeRfqContext.renglon || activeRfqContext.item_index + 1} | {activeRfqContext.codigo_acp || "S/C"} | {activeRfqContext.descripcion || "Sin descripción"}
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-4">
          <ModuleSection>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Wand2 className="h-4 w-4 text-brand" />
              1. Preparación
            </div>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Alcance
                <select value={scope} onChange={(event) => setScope(event.target.value)} className="app-input">
                  <option value="all">Todos los renglones</option>
                  {items.map((item, index) => (
                    <option key={index} value={index}>
                      {itemLabel(item, index)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                <label className="grid gap-2 text-sm font-semibold text-slate-800">
                  Idioma
                  <select value={language} onChange={(event) => setLanguage(event.target.value)} className="app-input">
                    <option value="English">English</option>
                    <option value="Spanish">Español</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-semibold text-slate-800">
                  Fecha límite proveedor
                  <input type="date" value={replyBy} onChange={(event) => setReplyBy(event.target.value)} className="app-input" />
                </label>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                El correo no agrega nombre, cargo ni empresa. Copia el contenido en Outlook y deja que la firma digital corporativa se inserte automáticamente.
              </div>
              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Condición de pago solicitada
                <select value={payment} onChange={(event) => setPayment(event.target.value)} className="app-input">
                  <option>Net 30 o superior</option>
                  <option>Net 45 si aplica</option>
                  <option>Net 60 si es posible</option>
                  <option>Contra entrega</option>
                </select>
              </label>
            </div>
          </ModuleSection>

          <ModuleSection>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-brand" />
              2. Confirmaciones que debe pedir
            </div>
            <div className="mt-4 grid gap-2">
              {checklist.map(([label, active]) => (
                <div key={label} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${metricTone(active)}`}>
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="leading-5">{label}</span>
                </div>
              ))}
            </div>
          </ModuleSection>

          <ModuleSection>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CalendarClock className="h-4 w-4 text-brand" />
              Datos del pliego
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              {[
                ["Entrega ACP", leadTime],
                ["Garantía", warranty],
                ["Validez", validity],
                ["Lugar de entrega", delivery]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                  <div className="mt-1 font-semibold leading-5 text-slate-900">{value}</div>
                </div>
              ))}
            </div>
          </ModuleSection>
        </div>

        <ModuleSection className="overflow-hidden p-0">
          <div className="border-b border-line bg-white p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">3. Revisar y enviar</div>
                <p className="mt-1 text-sm text-muted">Copia el correo completo para Outlook o descarga una versión HTML/TXT para expediente.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => setView("preview")} variant={view === "preview" ? "primary" : "secondary"} size="sm">
                  <FileText className="h-4 w-4" /> Preview
                </Button>
                <Button type="button" onClick={() => setView("edit")} variant={view === "edit" ? "primary" : "secondary"} size="sm">
                  <PencilLine className="h-4 w-4" /> Editar
                </Button>
              </div>
            </div>
          </div>

          {body ? (
            <div className="p-5">
              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Asunto
                <input value={subject} onChange={(event) => setSubject(event.target.value)} className="app-input" />
              </label>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <Button type="button" onClick={() => void copyText("todo", copyReadyEmail)} variant="primary" size="md" className="sm:col-span-2 xl:col-span-2">
                  <Clipboard className="h-4 w-4" /> {copied === "todo" ? "Copiado" : "Copiar completo"}
                </Button>
                <Button type="button" onClick={() => void copyText("asunto", subject)} variant="secondary" size="md">
                  <Clipboard className="h-4 w-4" /> Asunto
                </Button>
                <Button type="button" onClick={() => void copyText("cuerpo", body)} variant="secondary" size="md">
                  <Clipboard className="h-4 w-4" /> Cuerpo
                </Button>
                <Button type="button" onClick={() => downloadFile(`RFQ_${licitacion}.html`, html, "text/html")} variant="secondary" size="md">
                  <Download className="h-4 w-4" /> HTML
                </Button>
                <Button type="button" onClick={() => downloadFile(`RFQ_${licitacion}.txt`, body, "text/plain")} variant="secondary" size="md">
                  <Download className="h-4 w-4" /> TXT
                </Button>
              </div>

              {view === "preview" ? (
                <div className="mt-5 overflow-hidden rounded-xl border border-line bg-white">
                  <div className="border-b border-line bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Subject</div>
                    <div className="mt-1 text-base font-semibold leading-6 text-slate-950">{subject}</div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 xl:grid-cols-5">
                      <span className="rounded-md border border-line bg-white px-2 py-1">Bid: {licitacion}</span>
                      <span className="rounded-md border border-line bg-white px-2 py-1">Reply: {replyBy || "Pending"}</span>
                      <span className="rounded-md border border-line bg-white px-2 py-1">Lead time: {leadTime}</span>
                      <span className="rounded-md border border-line bg-white px-2 py-1">Payment: {payment}</span>
                      <span className="rounded-md border border-line bg-white px-2 py-1">Warranty: {warranty}</span>
                    </div>
                  </div>
                  <div className="max-h-[68vh] space-y-3 overflow-auto bg-slate-50 p-4 sm:p-5">
                    {blocks.map((block, index) => (
                      <div key={`${index}-${block.slice(0, 18)}`} className="rounded-lg border border-line bg-white p-4 text-sm leading-7 text-slate-800 shadow-sm">
                        <div className="whitespace-pre-wrap break-words">{block}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  className="mt-5 min-h-[64vh] w-full rounded-lg border border-line bg-white px-3 py-3 font-mono text-sm leading-6 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
                />
              )}
            </div>
          ) : (
            <div className="grid min-h-[620px] place-items-center p-8 text-center">
              <div>
                <Mail className="mx-auto h-10 w-10 text-brand" />
                <div className="mt-4 text-base font-semibold text-slate-900">Genera el primer borrador</div>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                  El correo aparecerá separado por asunto, datos del RFQ, solicitud comercial, requisitos técnicos y cierre profesional.
                </p>
              </div>
            </div>
          )}
        </ModuleSection>
      </section>
    </div>
  );
}






