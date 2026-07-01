import { apiRequest } from "@/lib/api";

export function generateRfqEmail(payload: {
  username: string;
  cg: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  language: string;
  contact_name: string;
  company: string;
  scope_label: string;
  payment_terms: string;
  reply_by: string;
  lead_time: string;
}) {
  return apiRequest<{ status: string; subject: string; body: string }>("/rfq-email/generate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function emailHtml(subject: string, body: string, meta: Array<[string, string]>) {
  const escapedSubject = escapeHtml(subject);
  const escapedBody = escapeHtml(body);
  const metaHtml = meta
    .map(([key, value]) => `<span><b>${escapeHtml(key)}</b><em>${escapeHtml(value)}</em></span>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#eef3f8;color:#111827;font-family:Arial,Helvetica,sans-serif}
.wrap{max-width:900px;margin:30px auto;padding:0 18px}
.card{overflow:hidden;border:1px solid #dbe3ef;border-radius:14px;background:#fff;box-shadow:0 14px 32px rgba(15,23,42,.08)}
.head{background:#123b73;color:white;padding:24px 26px}
.head small{display:block;color:#bfdbfe;font-weight:700;text-transform:uppercase;letter-spacing:.09em;font-size:11px}
h1{margin:8px 0 0;font-size:22px;line-height:1.3}
.meta{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:18px 24px;border-bottom:1px solid #e5e7eb;background:#f8fafc}
.meta span{border:1px solid #e5e7eb;border-radius:9px;background:white;padding:9px 10px;font-size:12px;color:#475569}
.meta b{display:block;color:#0f172a;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
.meta em{font-style:normal;font-weight:700;color:#1f2937}
.body{padding:26px}.body pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:Arial,Helvetica,sans-serif;line-height:1.68;font-size:14px;color:#111827}
.footer{padding:14px 24px;border-top:1px solid #e5e7eb;background:#f8fafc;color:#64748b;font-size:12px}
@media(max-width:760px){.meta{grid-template-columns:1fr 1fr}.wrap{margin:12px auto}.head,.body{padding:20px}}
@media(max-width:480px){.meta{grid-template-columns:1fr}}
</style></head><body><main class="wrap"><section class="card"><div class="head"><small>Proyelec International RFQ</small><h1>${escapedSubject}</h1></div><div class="meta">${metaHtml}</div><div class="body"><pre>${escapedBody}</pre></div><div class="footer">Generated from Procura AI. Review technical requirements and attachments before sending.</div></section></main></body></html>`;
}
