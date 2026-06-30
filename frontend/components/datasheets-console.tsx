"use client";

import { FileText, Loader2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { generateDatasheet } from "@/lib/datasheets";
import { type AuthUser } from "@/lib/auth";
import { cleanValue, getUserConfig, loadLastRfq, type RfqAnalysisResponse, type RfqItem } from "@/lib/rfq";

function itemLabel(item: RfqItem, index: number) {
  return `Renglon ${cleanValue(item.renglon, String(index + 1))} | ${cleanValue(item.codigo_articulo, "S/C")} | ${cleanValue(item.termino_de_busqueda_corto || item.descripcion, "Sin descripcion")}`;
}

export function DatasheetsConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [content, setContent] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRfq(loadLastRfq(user.username));
    getUserConfig(user.username)
      .then((config) => {
        setGeminiKey(config.gemini_key || "");
        setHasGeminiKey(Boolean(config.has_gemini_key || config.gemini_key));
      })
      .catch(() => undefined);
  }, [user.username]);

  const cg = (rfq?.condiciones_generales || {}) as Record<string, unknown>;
  const items = useMemo(() => rfq?.items || [], [rfq]);
  const selected = items[selectedIndex];
  const licitacion = cleanValue(cg.numero_licitacion, "Sin licitacion");

  async function run() {
    setError(null);
    if (!selected) return;
    if (!geminiKey.trim() && !hasGeminiKey) {
      setError("Falta Gemini API Key. Configurala en Admin o en el perfil del usuario.");
      return;
    }
    setLoading(true);
    try {
      const response = await generateDatasheet({
        username: user.username,
        licitacion,
        codigo_renglon: `${cleanValue(selected.renglon, "")}-${cleanValue(selected.codigo_articulo, "")}`,
        pliego_context: JSON.stringify(cg),
        items_context: JSON.stringify(selected),
        gemini_key: geminiKey
      });
      setContent(response.datasheet_md);
      setFromCache(Boolean(response.from_cache));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la ficha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-brand">Fichas Tecnicas</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Generador por renglon</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Genera fichas tecnicas estructuradas desde el contexto del pliego. El backend usa cache para no gastar tokens repetidos.
            </p>
          </div>
          <FileText className="h-5 w-5 text-brand" />
        </div>
      </section>

      {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <label className="grid gap-2 text-sm font-semibold text-slate-800">
            Renglon
            <select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))} className="h-11 rounded-lg border border-line bg-white px-3 text-sm outline-none">
              {items.map((item, index) => <option key={index} value={index}>{itemLabel(item, index)}</option>)}
            </select>
          </label>
          <button onClick={run} disabled={!items.length || loading} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Generar ficha
          </button>
          {fromCache && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Servida desde cache.</div>}
        </div>
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Ficha generada</div>
          <div className="mt-4 min-h-96 whitespace-pre-wrap rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-slate-800">
            {content || "La ficha aparecera aqui."}
          </div>
        </div>
      </section>
    </div>
  );
}
