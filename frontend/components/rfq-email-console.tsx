"use client";

import {
  CalendarClock,
  Check,
  Clipboard,
  Download,
  FileText,
  Loader2,
  Mail,
  PencilLine,
  UserRound,
  Wand2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type AuthUser } from "@/lib/auth";
import {
  asBool,
  cleanValue,
  loadActiveRfqContext,
  loadLastRfq,
  type ActiveRfqItemContext,
  type RfqAnalysisResponse,
  type RfqItem
} from "@/lib/rfq";
import { emailHtml, generateRfqEmail } from "@/lib/rfq-email";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ModuleSection } from "@/components/ui/module-section";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type RequirementRow = {
  line: string;
  code: string;
  quantity: string;
  description: string;
  documents: string;
};

type ConfirmationRow = {
  requirement: string;
  detail: string;
};

function itemLabel(item: RfqItem, index: number) {
  const line = cleanValue(item.renglon, String(index + 1));
  const code = cleanValue(item.codigo_articulo, "S/C");
  const description = cleanValue(item.termino_de_busqueda_corto || item.descripcion, "Sin descripción");
  return `Renglón ${line} | ${code} | ${description.slice(0, 76)}`;
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

function emailBlocks(body: string) {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bodyToHtml(body: string) {
  return emailBlocks(body)
    .map(
      (block) =>
        `<p style="margin:0 0 14px;color:#172033;font:14px/1.65 Arial,Helvetica,sans-serif">${escapeHtml(block).replaceAll("\n", "<br>")}</p>`
    )
    .join("");
}

function requirementRows(items: RfqItem[]): RequirementRow[] {
  return items.map((item, index) => {
    const documents = [
      asBool(item.requiere_ficha_tecnica) ? "Ficha/catálogo" : "",
      asBool(item.requiere_propuesta_tecnica) ? "Propuesta técnica" : "",
      cleanValue(item.marca_modelo_requerido, "") ? "Marca/modelo" : ""
    ].filter(Boolean);

    return {
      line: cleanValue(item.renglon, String(index + 1)),
      code: cleanValue(item.codigo_articulo, "S/C"),
      quantity: `${cleanValue(item.cantidad, "N/A")} ${cleanValue(item.unidad_de_medida || item.unidad, "")}`.trim(),
      description: cleanValue(item.termino_de_busqueda_corto || item.descripcion || item.ficha_tecnica_completa, "Sin descripción")
        .replace(/\s+/g, " ")
        .slice(0, 180),
      documents: documents.length ? documents.join(", ") : "Sin documento adicional identificado"
    };
  });
}

function supplierConfirmations(items: RfqItem[], leadTime: string, payment: string): ConfirmationRow[] {
  const rows: ConfirmationRow[] = [
    { requirement: "Precio unitario y moneda", detail: "Incluir mejor precio de proyecto o descuento por volumen" },
    { requirement: "Disponibilidad", detail: "Confirmar existencia y cantidad disponible" },
    { requirement: "Lead time", detail: `Confirmar cumplimiento: ${leadTime}` },
    { requirement: "Condición de pago", detail: payment },
    { requirement: "Origen e Incoterm", detail: "Indicar país de origen y EXW/FOB u otra condición aplicable" },
    { requirement: "Empaque y logística", detail: "Dimensiones, peso y volumen por paquete" },
    { requirement: "Garantía", detail: "Indicar cobertura y vigencia" }
  ];
  if (items.some((item) => asBool(item.requiere_ficha_tecnica))) {
    rows.push({ requirement: "Ficha técnica / catálogo", detail: "Adjuntar documentación del producto ofertado" });
  }
  if (items.some((item) => asBool(item.requiere_propuesta_tecnica))) {
    rows.push({ requirement: "Cumplimiento técnico", detail: "Confirmar cumplimiento y adjuntar soporte técnico" });
  }
  if (items.some((item) => cleanValue(item.marca_modelo_requerido, ""))) {
    rows.push({ requirement: "Marca, modelo y parte", detail: "Identificar exactamente el producto ofertado" });
  }
  return rows;
}

function requirementsText(rows: RequirementRow[], confirmations: ConfirmationRow[]) {
  if (!rows.length) return "";
  const lines = [
    "INFORMACIÓN A CONFIRMAR",
    "",
    "Requisito | Respuesta del proveedor | Comentarios / referencia",
    "----------|------------------------|-------------------------"
  ];
  confirmations.forEach((row) => lines.push(`${row.requirement}: ${row.detail} |  | `));
  lines.push(
    "",
    "RENGLONES A COTIZAR",
    "",
    "Renglón | Código ACP | Cantidad | Descripción | Documentos a adjuntar",
    "--------|------------|----------|-------------|----------------------"
  );
  rows.forEach((row) => lines.push(`${row.line} | ${row.code} | ${row.quantity} | ${row.description} | ${row.documents}`));
  return lines.join("\n");
}

function requirementsHtml(rows: RequirementRow[], confirmations: ConfirmationRow[]) {
  if (!rows.length) return "";
  const confirmationBody = confirmations
    .map(
      (row) => `<tr>
        <td style="padding:9px;border:1px solid #cfd8e6"><b>${escapeHtml(row.requirement)}</b><br><span style="color:#64748b">${escapeHtml(row.detail)}</span></td>
        <td style="padding:9px;border:1px solid #cfd8e6">&nbsp;</td>
        <td style="padding:9px;border:1px solid #cfd8e6">&nbsp;</td>
      </tr>`
    )
    .join("");
  const body = rows
    .map(
      (row) => `<tr>
        <td style="padding:9px;border:1px solid #cfd8e6;font-weight:700">${escapeHtml(row.line)}</td>
        <td style="padding:9px;border:1px solid #cfd8e6">${escapeHtml(row.code)}</td>
        <td style="padding:9px;border:1px solid #cfd8e6">${escapeHtml(row.quantity)}</td>
        <td style="padding:9px;border:1px solid #cfd8e6">${escapeHtml(row.description)}</td>
        <td style="padding:9px;border:1px solid #cfd8e6">${escapeHtml(row.documents)}</td>
      </tr>`
    )
    .join("");

  return `<div style="margin-top:22px">
    <div style="margin-bottom:8px;color:#172033;font:bold 13px Arial,Helvetica,sans-serif">Información a confirmar</div>
    <table style="width:100%;border-collapse:collapse;color:#172033;font:12px/1.45 Arial,Helvetica,sans-serif">
      <thead><tr style="background:#eef4ff">
        <th style="width:48%;padding:9px;border:1px solid #cfd8e6;text-align:left">Requisito</th>
        <th style="width:22%;padding:9px;border:1px solid #cfd8e6;text-align:left">Respuesta</th>
        <th style="width:30%;padding:9px;border:1px solid #cfd8e6;text-align:left">Comentarios / referencia</th>
      </tr></thead>
      <tbody>${confirmationBody}</tbody>
    </table>
  </div><div style="margin-top:22px">
    <div style="margin-bottom:8px;color:#172033;font:bold 13px Arial,Helvetica,sans-serif">Renglones a cotizar</div>
    <table style="width:100%;border-collapse:collapse;color:#172033;font:12px/1.45 Arial,Helvetica,sans-serif">
      <thead><tr style="background:#eef4ff">
        <th style="padding:9px;border:1px solid #cfd8e6;text-align:left">Renglón</th>
        <th style="padding:9px;border:1px solid #cfd8e6;text-align:left">Código ACP</th>
        <th style="padding:9px;border:1px solid #cfd8e6;text-align:left">Cantidad</th>
        <th style="padding:9px;border:1px solid #cfd8e6;text-align:left">Descripción</th>
        <th style="padding:9px;border:1px solid #cfd8e6;text-align:left">Documentos</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

export function RfqEmailConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [recipientName, setRecipientName] = useState("");
  const [recipientCompany, setRecipientCompany] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [language, setLanguage] = useState("English");
  const [payment, setPayment] = useState("Net 30 o superior");
  const [replyBy, setReplyBy] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRfqContext, setActiveRfqContext] = useState<ActiveRfqItemContext | null>(null);

  useEffect(() => {
    const savedRfq = loadLastRfq(user.username);
    const context = loadActiveRfqContext(user.username);
    const savedItems = savedRfq?.items || [];
    setRfq(savedRfq);
    setActiveRfqContext(context?.target_module === "rfq_email" ? context : null);

    if (savedItems.length && context?.target_module === "rfq_email") {
      const nextIndex = Math.min(Math.max(Number(context.item_index) || 0, 0), savedItems.length - 1);
      setSelectedIndexes([nextIndex]);
    } else {
      setSelectedIndexes(savedItems.map((_, index) => index));
    }
  }, [user.username]);

  const cg = (rfq?.condiciones_generales || {}) as Record<string, unknown>;
  const items = useMemo(() => rfq?.items || [], [rfq]);
  const selectedItems = useMemo(
    () => selectedIndexes.filter((index) => items[index]).sort((a, b) => a - b).map((index) => items[index]),
    [items, selectedIndexes]
  );
  const rows = useMemo(() => requirementRows(selectedItems), [selectedItems]);
  const licitacion = getCg(cg, ["numero_licitacion", "licitacion", "rfq_id"], "RFQ");
  const leadTime = getCg(cg, ["tiempo_de_entrega_global", "tiempo_entrega", "plazo_entrega"], "No especificado");
  const warranty = getCg(cg, ["garantia_exigida", "garantia", "garantia_requerida"], "No especificado");
  const delivery = getCg(cg, ["lugar_de_entrega", "lugar_entrega", "entrega"], "No especificado");
  const validity = getCg(cg, ["validez_de_la_oferta", "validez_oferta", "validez"], "No especificado");
  const confirmations = useMemo(
    () => supplierConfirmations(selectedItems, leadTime, payment),
    [leadTime, payment, selectedItems]
  );
  const matrixText = useMemo(() => requirementsText(rows, confirmations), [confirmations, rows]);
  const matrixHtml = useMemo(() => requirementsHtml(rows, confirmations), [confirmations, rows]);
  const allSelected = items.length > 0 && selectedIndexes.length === items.length;
  const selectedLineNumbers = selectedItems.map((item, index) => cleanValue(item.renglon, String(index + 1))).join(", ");
  const scopeLabel = language === "English"
    ? allSelected ? "All line items" : `Line items ${selectedLineNumbers}`
    : allSelected ? "Todos los renglones" : `Renglones ${selectedLineNumbers}`;
  const richBody = `${bodyToHtml(body)}${matrixHtml}`;
  const plainBody = `${body}${matrixText ? `\n\n${matrixText}` : ""}`;
  const recipientLine = recipientEmail || recipientName || recipientCompany || "Proveedor por definir";
  const fullPlainEmail = `Para: ${recipientLine}\nAsunto: ${subject}\n\n${plainBody}`;
  const fullRichEmail = `<div style="font:14px Arial,Helvetica,sans-serif;color:#172033"><div style="margin-bottom:6px"><b>Para:</b> ${escapeHtml(
    recipientLine
  )}</div><div style="margin-bottom:18px"><b>Asunto:</b> ${escapeHtml(subject)}</div>${richBody}</div>`;
  const html = emailHtml(
    subject || "Request for Quotation",
    plainBody,
    [
      ["Bid", licitacion],
      ["Reply by", replyBy || "Pending"],
      ["Lead time", leadTime],
      ["Payment", payment]
    ],
    richBody
  );

  function toggleItem(index: number) {
    setSelectedIndexes((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((a, b) => a - b)
    );
  }

  async function generate() {
    if (!selectedItems.length) {
      setError("Selecciona al menos un renglón para generar el correo.");
      return;
    }
    setError(null);
    setCopied(null);
    setLoading(true);
    try {
      const response = await generateRfqEmail({
        username: user.username,
        cg,
        items: selectedItems as Array<Record<string, unknown>>,
        language,
        contact_name: recipientName,
        company: recipientCompany,
        scope_label: scopeLabel,
        payment_terms: payment,
        reply_by: replyBy,
        lead_time: leadTime
      });
      setSubject(response.subject);
      setBody(response.body);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el correo RFQ.");
    } finally {
      setLoading(false);
    }
  }

  async function copyRich(label: string, plain: string, rich?: string) {
    if (!plain.trim()) return;
    try {
      if (rich && "ClipboardItem" in window && navigator.clipboard.write) {
        const clipboardItem = new ClipboardItem({
          "text/plain": new Blob([plain], { type: "text/plain" }),
          "text/html": new Blob([rich], { type: "text/html" })
        });
        await navigator.clipboard.write([clipboardItem]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
    } catch {
      await navigator.clipboard.writeText(plain);
    }
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="space-y-5">
      <ModuleSection>
        <PageHeader
          eyebrow="Correo RFQ"
          title="Solicitud de cotización"
          copy="Selecciona los renglones, define las condiciones y genera un correo listo para Outlook."
          actions={
            <StatusBadge tone={selectedItems.length ? "info" : "neutral"}>
              {selectedItems.length} de {items.length} renglones
            </StatusBadge>
          }
        />
      </ModuleSection>

      {!items.length ? (
        <ModuleSection>
          <EmptyState
            icon={FileText}
            title="Primero necesitas un RFQ analizado"
            copy="Analiza un pliego o abre un espacio guardado. Luego vuelve aquí para preparar la solicitud al proveedor."
          />
        </ModuleSection>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {error}
        </div>
      ) : null}

      {items.length ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <ModuleSection>
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-brand">
                  <UserRound className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-ink">Preparación</h2>
                  <p className="mt-1 text-sm leading-5 text-muted">Los datos del destinatario son opcionales.</p>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                <label className="grid gap-2 text-sm font-semibold text-ink">
                  Correo del proveedor
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(event) => setRecipientEmail(event.target.value)}
                    placeholder="ventas@proveedor.com"
                    className="app-input"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="grid gap-2 text-sm font-semibold text-ink">
                    Contacto
                    <input
                      value={recipientName}
                      onChange={(event) => setRecipientName(event.target.value)}
                      placeholder="Opcional"
                      className="app-input"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold text-ink">
                    Empresa proveedora
                    <input
                      value={recipientCompany}
                      onChange={(event) => setRecipientCompany(event.target.value)}
                      placeholder="Opcional"
                      className="app-input"
                    />
                  </label>
                </div>
              </div>
            </ModuleSection>

            <ModuleSection>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-ink">Renglones incluidos</h2>
                  <p className="mt-1 text-sm text-muted">Elige solo lo que solicitarás a este proveedor.</p>
                </div>
                <Button
                  type="button"
                  onClick={() => setSelectedIndexes(allSelected ? [] : items.map((_, index) => index))}
                  variant="ghost"
                  size="sm"
                >
                  {allSelected ? "Limpiar" : "Todos"}
                </Button>
              </div>

              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                {items.map((item, index) => {
                  const checked = selectedIndexes.includes(index);
                  return (
                    <label
                      key={`${cleanValue(item.renglon, String(index))}-${index}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                        checked
                          ? "border-blue-300 bg-blue-50 text-blue-950"
                          : "border-line bg-panel text-ink hover:border-blue-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(index)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-5">{itemLabel(item, index)}</span>
                        <span className="mt-1 block text-xs text-muted">
                          Cant. {cleanValue(item.cantidad, "N/A")} {cleanValue(item.unidad_de_medida || item.unidad, "")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {activeRfqContext ? (
                <p className="mt-3 text-xs leading-5 text-muted">
                  Abierto desde el renglón {activeRfqContext.renglon || activeRfqContext.item_index + 1} del RFQ.
                </p>
              ) : null}
            </ModuleSection>

            <ModuleSection>
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-brand">
                  <CalendarClock className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-ink">Condiciones comerciales</h2>
                  <p className="mt-1 text-sm leading-5 text-muted">Lo mínimo que debe confirmar el proveedor.</p>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="grid gap-2 text-sm font-semibold text-ink">
                    Idioma
                    <select value={language} onChange={(event) => setLanguage(event.target.value)} className="app-input">
                      <option value="English">English</option>
                      <option value="Spanish">Español</option>
                    </select>
                  </label>
                  <label className="grid gap-2 text-sm font-semibold text-ink">
                    Responder antes de
                    <input type="date" value={replyBy} onChange={(event) => setReplyBy(event.target.value)} className="app-input" />
                  </label>
                </div>
                <label className="grid gap-2 text-sm font-semibold text-ink">
                  Pago solicitado
                  <select value={payment} onChange={(event) => setPayment(event.target.value)} className="app-input">
                    <option>Net 30 o superior</option>
                    <option>Net 45 si aplica</option>
                    <option>Net 60 si es posible</option>
                    <option>Contra entrega</option>
                  </select>
                </label>
              </div>

              <details className="mt-4 rounded-lg border border-line bg-panel p-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink">Condiciones extraídas del pliego</summary>
                <dl className="mt-3 grid gap-3 text-sm">
                  {[
                    ["Entrega", leadTime],
                    ["Lugar", delivery],
                    ["Garantía", warranty],
                    ["Validez", validity]
                  ].map(([label, value]) => (
                    <div key={label} className="grid gap-1 border-t border-line pt-2 first:border-0 first:pt-0">
                      <dt className="text-xs font-semibold text-muted">{label}</dt>
                      <dd className="leading-5 text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>

              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                El borrador no incluye remitente ni firma. Outlook agregará tu firma corporativa al pegarlo.
              </div>

              <Button type="button" onClick={generate} disabled={!selectedItems.length || loading} variant="primary" size="lg" className="mt-5 w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {loading ? "Generando..." : body ? "Regenerar correo" : "Generar correo"}
              </Button>
            </ModuleSection>
          </div>

          <ModuleSection className="min-w-0 overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink">Vista previa</h2>
                <p className="mt-1 text-sm text-muted">Revisa el contenido antes de copiarlo a Outlook.</p>
              </div>
              {body ? <StatusBadge tone="ok">Borrador listo</StatusBadge> : <StatusBadge tone="neutral">Pendiente</StatusBadge>}
            </div>

            {body ? (
              <div className="min-w-0 p-4 sm:p-5">
                <div className="grid min-w-0 gap-3">
                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-ink">
                    Para
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(event) => setRecipientEmail(event.target.value)}
                      placeholder="ventas@proveedor.com"
                      className="app-input min-w-0"
                    />
                  </label>
                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-ink">
                    Asunto
                    <input value={subject} onChange={(event) => setSubject(event.target.value)} className="app-input min-w-0" />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void copyRich("completo", fullPlainEmail, fullRichEmail)} variant="primary">
                    {copied === "completo" ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                    {copied === "completo" ? "Correo copiado" : "Copiar correo completo"}
                  </Button>
                  <Button type="button" onClick={() => void copyRich("asunto", subject)} variant="secondary">
                    <Clipboard className="h-4 w-4" /> {copied === "asunto" ? "Asunto copiado" : "Copiar asunto"}
                  </Button>
                  <Button type="button" onClick={() => void copyRich("cuerpo", plainBody, richBody)} variant="secondary">
                    <Clipboard className="h-4 w-4" /> {copied === "cuerpo" ? "Cuerpo copiado" : "Copiar cuerpo"}
                  </Button>
                  <Button type="button" onClick={() => void copyRich("tabla", matrixText, matrixHtml)} variant="secondary">
                    <Clipboard className="h-4 w-4" /> {copied === "tabla" ? "Tabla copiada" : "Copiar tabla"}
                  </Button>
                  <Button type="button" onClick={() => setEditing((current) => !current)} variant="ghost">
                    <PencilLine className="h-4 w-4" /> {editing ? "Ver correo" : "Editar texto"}
                  </Button>
                </div>

                {editing ? (
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="mt-5 min-h-[560px] w-full resize-y p-4 text-sm leading-6"
                    aria-label="Cuerpo editable del correo"
                  />
                ) : (
                  <div className="mt-5 overflow-hidden rounded-lg border border-line bg-panel">
                    <div className="border-b border-line bg-slate-50 px-4 py-3 text-sm sm:px-5">
                      <div className="grid gap-2 sm:grid-cols-[72px_minmax(0,1fr)]">
                        <span className="font-semibold text-muted">Para</span>
                        <span className="min-w-0 break-words text-ink">{recipientLine}</span>
                        <span className="font-semibold text-muted">Asunto</span>
                        <span className="min-w-0 break-words font-semibold text-ink">{subject}</span>
                      </div>
                    </div>
                    <article className="min-w-0 p-4 sm:p-6">
                      <div className="space-y-4 text-sm leading-7 text-ink">
                        {emailBlocks(body).map((block, index) => (
                          <p key={`${index}-${block.slice(0, 16)}`} className="whitespace-pre-wrap break-words">
                            {block}
                          </p>
                        ))}
                      </div>

                      <div className="mt-7">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-ink">Información a confirmar</h3>
                          <StatusBadge tone="warn">Proveedor completa</StatusBadge>
                        </div>
                        <div className="hidden overflow-hidden rounded-lg border border-line md:block">
                          <table className="app-table w-full table-fixed text-left text-xs">
                            <thead>
                              <tr>
                                <th className="w-[48%] p-3">Requisito</th>
                                <th className="w-[22%] p-3">Respuesta</th>
                                <th className="w-[30%] p-3">Comentarios / referencia</th>
                              </tr>
                            </thead>
                            <tbody>
                              {confirmations.map((row) => (
                                <tr key={row.requirement}>
                                  <td className="break-words p-3 leading-5">
                                    <span className="font-semibold">{row.requirement}</span>
                                    <span className="mt-1 block text-muted">{row.detail}</span>
                                  </td>
                                  <td className="p-3 text-muted">Por completar</td>
                                  <td className="p-3 text-muted">—</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="grid gap-2 md:hidden">
                          {confirmations.map((row) => (
                            <div key={`${row.requirement}-mobile`} className="rounded-lg border border-line bg-slate-50 p-3">
                              <div className="text-sm font-semibold text-ink">{row.requirement}</div>
                              <p className="mt-1 text-xs leading-5 text-muted">{row.detail}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-7">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-ink">Renglones a cotizar</h3>
                          <StatusBadge tone="info">{rows.length} seleccionados</StatusBadge>
                        </div>
                        <div className="hidden overflow-hidden rounded-lg border border-line md:block">
                          <table className="app-table w-full table-fixed text-left text-xs">
                            <thead>
                              <tr>
                                <th className="w-[11%] p-3">Renglón</th>
                                <th className="w-[18%] p-3">Código ACP</th>
                                <th className="w-[15%] p-3">Cantidad</th>
                                <th className="w-[34%] p-3">Descripción</th>
                                <th className="w-[22%] p-3">Documentos</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row, index) => (
                                <tr key={`${row.line}-${row.code}-${index}`}>
                                  <td className="break-words p-3 font-semibold">{row.line}</td>
                                  <td className="break-words p-3">{row.code}</td>
                                  <td className="break-words p-3">{row.quantity}</td>
                                  <td className="break-words p-3 leading-5">{row.description}</td>
                                  <td className="break-words p-3 leading-5">{row.documents}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="grid gap-3 md:hidden">
                          {rows.map((row, index) => (
                            <div key={`${row.line}-${row.code}-mobile-${index}`} className="rounded-lg border border-line bg-slate-50 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-ink">Renglón {row.line}</span>
                                <StatusBadge tone="neutral">{row.code}</StatusBadge>
                              </div>
                              <p className="mt-2 text-sm leading-5 text-ink">{row.description}</p>
                              <dl className="mt-3 grid gap-2 text-xs">
                                <div><dt className="font-semibold text-muted">Cantidad</dt><dd className="mt-0.5 text-ink">{row.quantity}</dd></div>
                                <div><dt className="font-semibold text-muted">Documentos</dt><dd className="mt-0.5 text-ink">{row.documents}</dd></div>
                              </dl>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-6 border-t border-line pt-4 text-xs leading-5 text-muted">
                        La firma corporativa se agregará desde tu correo.
                      </div>
                    </article>
                  </div>
                )}

                <details className="mt-4 rounded-lg border border-line bg-panel p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-ink">Descargar una copia</summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={() => downloadFile(`RFQ_${licitacion}.html`, html, "text/html")} variant="secondary" size="sm">
                      <Download className="h-4 w-4" /> HTML
                    </Button>
                    <Button type="button" onClick={() => downloadFile(`RFQ_${licitacion}.txt`, fullPlainEmail, "text/plain")} variant="secondary" size="sm">
                      <Download className="h-4 w-4" /> TXT
                    </Button>
                  </div>
                </details>
              </div>
            ) : (
              <div className="p-5">
                <EmptyState
                  icon={Mail}
                  title="El borrador aparecerá aquí"
                  copy="Selecciona los renglones y pulsa Generar correo. Podrás revisar, editar y copiar el resultado sin perder el formato."
                  className="min-h-[420px]"
                />
              </div>
            )}
          </ModuleSection>
        </div>
      ) : null}
    </div>
  );
}
