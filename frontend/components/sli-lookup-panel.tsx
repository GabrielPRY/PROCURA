"use client";

import { ExternalLink, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { consultarSli, type SliLookupResult } from "@/lib/sli";

function cleanRfq(value: string) {
  return value.replace(/\D/g, "");
}

function valueOrDash(value?: string | null) {
  return value && String(value).trim() ? value : "N/D";
}

export function SliLookupPanel({ initialRfq = "", compact = false }: { initialRfq?: string; compact?: boolean }) {
  const [rfq, setRfq] = useState(cleanRfq(initialRfq));
  const [result, setResult] = useState<SliLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRfq(cleanRfq(initialRfq));
    setResult(null);
    setError(null);
  }, [initialRfq]);

  async function runLookup() {
    const nextRfq = cleanRfq(rfq || initialRfq);
    if (!nextRfq) return;
    setRfq(nextRfq);
    setError(null);
    setLoading(true);
    try {
      const response = await consultarSli(nextRfq);
      setResult(response);
      if (response.error) setError(response.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar el SLI.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`rounded-xl border border-line bg-panel shadow-sm ${compact ? "p-4" : "p-5"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-sm font-semibold text-brand">Consulta SLI puntual</div>
          {!compact && <p className="mt-1 text-sm text-muted">Consulta estado real, fechas, agente y resumen/acta del portal ACP.</p>}
        </div>
        <div className="flex gap-2">
          <input
            value={rfq}
            onChange={(event) => setRfq(cleanRfq(event.target.value))}
            placeholder="Numero RFQ"
            className="h-10 w-40 rounded-lg border border-line bg-white px-3 text-sm outline-none"
          />
          <button
            type="button"
            onClick={runLookup}
            disabled={loading || !cleanRfq(rfq || initialRfq)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Consultar
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["Estado", valueOrDash(result.estatus)],
              ["Publicacion", valueOrDash(result.fecha_publicacion)],
              ["Cierre", valueOrDash(result.fecha_cierre)],
              ["Agente", valueOrDash(result.agente_compras)]
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-line bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Descripcion</div>
            <div className="mt-1 text-sm leading-6 text-slate-800">{valueOrDash(result.descripcion)}</div>
          </div>
          <div className={`rounded-lg border p-3 ${result.requiere_revision_rfq ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className={`text-xs font-semibold uppercase tracking-wide ${result.requiere_revision_rfq ? "text-amber-800" : "text-emerald-800"}`}>
              Codigos ACP visibles
            </div>
            {result.codigos_acp_detectados?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {result.codigos_acp_detectados.map((code) => (
                  <span key={code} className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800">
                    {code}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-sm leading-6 text-amber-900">
                {result.nota_revision_rfq || "No se detectaron codigos visibles; hay que revisar el RFQ/pliego."}
              </div>
            )}
          </div>
          {result.renglones_detectados?.length ? (
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              <div className="border-b border-line bg-slate-50 px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Renglones visibles detectados</div>
                <div className="mt-1 text-xs text-slate-600">
                  Lectura automatica del detalle SLI. Si falta algun item, revisar el RFQ/pliego antes de decidir.
                </div>
              </div>
              <div className="overflow-hidden">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead className="bg-white text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="border-b border-line px-3 py-2">Renglon</th>
                      <th className="border-b border-line px-3 py-2">Codigo ACP</th>
                      <th className="border-b border-line px-3 py-2">Descripcion / contexto visible</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.renglones_detectados.map((item, index) => (
                      <tr key={`${item.renglon}-${item.codigo_articulo}-${index}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-semibold text-slate-900">{valueOrDash(item.renglon)}</td>
                        <td className="px-3 py-2">
                          {item.codigo_articulo ? (
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              {item.codigo_articulo}
                            </span>
                          ) : (
                            <span className="text-muted">N/D</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{valueOrDash(item.descripcion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {result.resumen_acta && (
            <div className="rounded-lg border border-line bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Resumen / acta</div>
                {result.resumen_acta.url && (
                  <a href={result.resumen_acta.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
                    Abrir acta <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-800">
                {result.resumen_acta.resumen || result.resumen_acta.error || "No hay resumen disponible."}
              </div>
              {result.resumen_acta.hallazgos?.length ? (
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {result.resumen_acta.hallazgos.map((item, index) => (
                    <li key={index} className="rounded-md bg-slate-50 p-2">{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          {result.url && (
            <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-brand">
              Abrir detalle SLI <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      )}
    </section>
  );
}
