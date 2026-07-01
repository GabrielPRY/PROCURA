"use client";

import {
  CheckCircle2,
  Clipboard,
  Download,
  FileText,
  Loader2,
  Mail,
  PencilLine,
  Send,
  Wand2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type AuthUser } from "@/lib/auth";
import { asBool, cleanValue, loadActiveRfqContext, loadLastRfq, type ActiveRfqItemContext, type RfqAnalysisResponse, type RfqItem } from "@/lib/rfq";
import { emailHtml, generateRfqEmail } from "@/lib/rfq-email";

function itemLabel(item: RfqItem, index: number) {
  return `Renglon ${cleanValue(item.renglon, String(index + 1))} | ${cleanValue(item.codigo_articulo, "S/C")} | ${cleanValue(
    item.termino_de_busqueda_corto || item.descripcion,
    "Sin descripcion"
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
    ["Stock availability and lead time", true],
    [`Compliance with required lead time: ${leadTime}`, true],
    [`Payment terms requested: ${payment}`, true],
    ["Incoterm EXW or FOB, country of origin", true],
    ["Packing dimensions, weight and volume", true],
    ["Warranty confirmation", true],
    ["Datasheet / catalog required", hasFicha],
    ["Technical proposal support", hasProposal],
    ["Brand / model restriction review", hasBrand]
  ] as Array<[string, boolean]>;
}

export function RfqEmailConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [scope, setScope] = useState("all");
  const [language, setLanguage] = useState("English");
  const [contact, setContact] = useState("Gabriel Rodriguez");
  const [company, setCompany] = useState("Proyelec International");
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
        contact_name: contact,
        company,
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

  const copyReadyEmail = subject ? `Subject: ${subject}

${body}` : body;

  const html = emailHtml(subject || "Request for Quotation", body, [
    ["Bid", licitacion],
    ["Reply by", replyBy || "Pending"],
    ["Lead time", leadTime],
    ["Payment", payment],
    ["Warranty", warranty]
  ]);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
        <div className="grid gap-0 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="p-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand">
              <Mail className="h-3.5 w-3.5" />
              Correo RFQ premium
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Solicitud profesional para proveedores</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Genera un correo claro, editable y listo para enviar. El proveedor debe confirmar precio, cumplimiento tecnico, lead time, garantia,
              dimensiones, Incoterm y condiciones de pago.
            </p>
          </div>
          <div className="border-t border-line bg-slate-50 p-5 xl:border-l xl:border-t-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">RFQ activo</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">{licitacion}</div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="text-xs text-muted">Items</div>
                <div className="mt-1 text-lg font-semibold">{selectedItems.length}</div>
              </div>
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="text-xs text-muted">Fichas</div>
                <div className="mt-1 text-lg font-semibold">{fichaCount}</div>
              </div>
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="text-xs text-muted">Marca</div>
                <div className="mt-1 text-lg font-semibold">{brandCount}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {!items.length && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Analiza primero un RFQ o abre un workspace guardado para que el correo salga con contexto real.
        </section>
      )}
      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}

      {activeRfqContext ? (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="font-semibold">Renglon recibido desde RFQ</div>
          <p className="mt-1 leading-6">
            Renglon {activeRfqContext.renglon || activeRfqContext.item_index + 1} | {activeRfqContext.codigo_acp || "S/C"} |{" "}
            {activeRfqContext.descripcion || "Sin descripcion"}
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[0.42fr_0.58fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Wand2 className="h-4 w-4 text-brand" />
              Configuracion del correo
            </div>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Alcance
                <select value={scope} onChange={(event) => setScope(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none">
                  <option value="all">Todos los renglones</option>
                  {items.map((item, index) => (
                    <option key={index} value={index}>
                      {itemLabel(item, index)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-slate-800">
                  Idioma
                  <select value={language} onChange={(event) => setLanguage(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none">
                    <option value="English">English</option>
                    <option value="Spanish">Espanol</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-semibold text-slate-800">
                  Fecha limite proveedor
                  <input type="date" value={replyBy} onChange={(event) => setReplyBy(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none" />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-slate-800">
                  Contacto
                  <input value={contact} onChange={(event) => setContact(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none" />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-slate-800">
                  Empresa
                  <input value={company} onChange={(event) => setCompany(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none" />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Condicion de pago solicitada
                <select value={payment} onChange={(event) => setPayment(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none">
                  <option>Net 30 o superior</option>
                  <option>Net 45 si aplica</option>
                  <option>Net 60 si es posible</option>
                  <option>Contra entrega</option>
                </select>
              </label>
              <button
                type="button"
                onClick={generate}
                disabled={!items.length || loading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Generar correo
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-brand" />
              Lo que debe confirmar el proveedor
            </div>
            <div className="mt-4 space-y-2">
              {checklist.map(([label, active]) => (
                <div key={label} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${metricTone(active)}`}>
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel shadow-sm">
          <div className="border-b border-line p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Vista previa del correo</div>
                <p className="mt-1 text-sm text-muted">Primero revisa el email como lo vera el proveedor; edita solo cuando haga falta.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setView("preview")}
                  className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
                    view === "preview" ? "border-blue-200 bg-blue-50 text-brand" : "border-line bg-white text-slate-700"
                  }`}
                >
                  <FileText className="h-4 w-4" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setView("edit")}
                  className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
                    view === "edit" ? "border-blue-200 bg-blue-50 text-brand" : "border-line bg-white text-slate-700"
                  }`}
                >
                  <PencilLine className="h-4 w-4" />
                  Editar
                </button>
              </div>
            </div>
          </div>

          {body ? (
            <div className="p-5">
              <label className="grid gap-2 text-sm font-semibold text-slate-800">
                Asunto
                <input value={subject} onChange={(event) => setSubject(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none" />
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyText("asunto", subject)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold">
                  <Clipboard className="h-4 w-4" /> {copied === "asunto" ? "Asunto copiado" : "Copiar asunto"}
                </button>
                <button type="button" onClick={() => void copyText("todo", copyReadyEmail)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700">
                  <Clipboard className="h-4 w-4" /> {copied === "todo" ? "Todo copiado" : "Copiar asunto + cuerpo"}
                </button>
                <button type="button" onClick={() => void copyText("cuerpo", body)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold">
                  <Clipboard className="h-4 w-4" /> {copied === "cuerpo" ? "Cuerpo copiado" : "Solo cuerpo"}
                </button>
                <button type="button" onClick={() => downloadFile(`RFQ_${licitacion}.txt`, body, "text/plain")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold">
                  <Download className="h-4 w-4" /> TXT
                </button>
                <button type="button" onClick={() => downloadFile(`RFQ_${licitacion}.html`, html, "text/html")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold">
                  <Download className="h-4 w-4" /> HTML
                </button>
              </div>

              {view === "preview" ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">
                  <div className="border-b border-line bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Subject</div>
                    <div className="mt-1 text-base font-semibold text-slate-900">{subject}</div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-700 md:grid-cols-2 xl:grid-cols-4">
                      <span className="rounded-md border border-line bg-white px-2 py-1">Bid: {licitacion}</span>
                      <span className="rounded-md border border-line bg-white px-2 py-1">Reply: {replyBy || "Pending"}</span>
                      <span className="rounded-md border border-line bg-white px-2 py-1">Lead time: {leadTime}</span>
                      <span className="rounded-md border border-line bg-white px-2 py-1">Payment: {payment}</span>
                    </div>
                  </div>
                  <div className="max-h-[62vh] overflow-auto p-4 sm:p-5">
                    <div className="mx-auto max-w-3xl whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-800 shadow-sm sm:p-5">
                      {body}
                    </div>
                  </div>
                </div>
              ) : (
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  className="mt-4 min-h-[52vh] w-full rounded-lg border border-line bg-white px-3 py-3 font-mono text-sm leading-6 outline-none"
                />
              )}
            </div>
          ) : (
            <div className="grid min-h-[560px] place-items-center p-8 text-center">
              <div>
                <Mail className="mx-auto h-10 w-10 text-brand" />
                <div className="mt-4 text-base font-semibold text-slate-900">Genera el primer borrador</div>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                  El correo aparecera con asunto, resumen de licitacion, tabla de requerimientos y solicitud comercial/logistica al proveedor.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border border-line bg-panel p-5 shadow-sm md:grid-cols-4">
        {[
          ["Entrega ACP", leadTime],
          ["Garantia", warranty],
          ["Validez", validity],
          ["Lugar entrega", delivery]
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-2 text-sm font-semibold leading-5 text-slate-900">{value}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
