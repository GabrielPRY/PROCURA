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

export function emailHtml(subject: string, body: string, meta: Array<[string, string]>) {
  const escapedSubject = subject.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const escapedBody = body
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br />");
  const metaHtml = meta
    .map(([key, value]) => {
      const safeKey = key.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const safeValue = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      return `<span><b>${safeKey}</b>${safeValue}</span>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f3f6fb;color:#111827;font-family:Arial,Helvetica,sans-serif}
.wrap{max-width:860px;margin:32px auto;padding:0 18px}
.card{overflow:hidden;border:1px solid #dbe3ef;border-radius:14px;background:#fff;box-shadow:0 14px 30px rgba(15,23,42,.08)}
.head{background:#0f172a;color:white;padding:22px 24px}
.head small{display:block;color:#93c5fd;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
h1{margin:8px 0 0;font-size:22px;line-height:1.3}
.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:18px 24px;border-bottom:1px solid #e5e7eb;background:#f8fafc}
.meta span{border:1px solid #e5e7eb;border-radius:8px;background:white;padding:8px 10px;font-size:12px;color:#475569}
.meta b{display:block;color:#0f172a;margin-bottom:3px}
.body{padding:24px;font-size:14px}.body pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:Arial,Helvetica,sans-serif;line-height:1.65;color:#111827}
@media(max-width:640px){.meta{grid-template-columns:1fr}.wrap{margin:12px auto}}
</style></head><body><main class="wrap"><section class="card"><div class="head"><small>Proyelec International RFQ</small><h1>${escapedSubject}</h1></div><div class="meta">${metaHtml}</div><div class="body"><pre>${escapedBody.replaceAll("<br />", "\n")}</pre></div></section></main></body></html>`;
}
