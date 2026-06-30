"use client";

import {
  AlertTriangle,
  Bot,
  Clipboard,
  FileText,
  Loader2,
  MessageSquareText,
  Send,
  Sparkles,
  Target
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { askAdvisor, askCopilot, type ChatMessage } from "@/lib/ai-command";
import { type AuthUser } from "@/lib/auth";
import { asBool, cleanValue, loadLastRfq, type RfqAnalysisResponse } from "@/lib/rfq";

const advisorModes = [
  {
    value: "Negociacion de precio",
    label: "Negociacion",
    copy: "Bajar precio, pedir volumen, Net 30 y mejorar condiciones."
  },
  {
    value: "Evaluacion de riesgo",
    label: "Riesgo",
    copy: "Detectar puntos que pueden afectar participacion o cumplimiento."
  },
  {
    value: "Tips para licitacion ACP",
    label: "Estrategia ACP",
    copy: "Preparar dudas, enfoque de oferta y alertas de descalificacion."
  },
  {
    value: "Condiciones contractuales",
    label: "Contrato",
    copy: "Revisar garantia, entrega, validez, penalidades y terminos."
  }
];

const situationTemplates = [
  "El proveedor respondio con precio alto. Ayudame a pedir mejor precio, descuento por volumen, Net 30 o condiciones superiores sin sonar agresivo.",
  "Necesito decidir si participamos. Revisa riesgos tecnicos, comerciales y logisticos con base en el RFQ cargado.",
  "El proveedor ofrece una alternativa tecnica. Ayudame a validar si conviene pedir aclaracion, ficha tecnica o carta de fabricante.",
  "Necesito redactar una respuesta profesional al proveedor solicitando precio final, lead time, garantia, dimensiones, peso e Incoterm."
];

const copilotQuestions = [
  "Resume los riesgos principales de esta licitacion.",
  "Que documentos no debemos olvidar para no quedar descalificados?",
  "Que renglones requieren propuesta tecnica o ficha tecnica?",
  "Que preguntas formales conviene enviar a la ACP?",
  "La entrega y garantia parecen manejables?",
  "Que informacion falta para cotizar con seguridad?"
];

function getRfqNumber(rfq: RfqAnalysisResponse | null) {
  const cg = (rfq?.condiciones_generales || {}) as Record<string, unknown>;
  return cleanValue(cg.numero_licitacion, "Sin RFQ activo");
}

function getTechnicalCounts(rfq: RfqAnalysisResponse | null) {
  const items = rfq?.items || [];
  return {
    total: items.length,
    propuesta: items.filter((item) => asBool(item.requiere_propuesta_tecnica)).length,
    ficha: items.filter((item) => asBool(item.requiere_ficha_tecnica)).length,
    obsoletos: items.filter((item) => asBool(item.posible_obsolescencia)).length
  };
}

function formatAnswer(text: string) {
  if (!text.trim()) return "La respuesta aparecera aqui con secciones accionables.";
  return text;
}

export function AiCommandConsole({ user }: { user: AuthUser }) {
  const [rfq, setRfq] = useState<RfqAnalysisResponse | null>(null);
  const [mode, setMode] = useState<"advisor" | "copilot">("advisor");
  const [situation, setSituation] = useState("");
  const [analysisMode, setAnalysisMode] = useState("Negociacion de precio");
  const [referencePrice, setReferencePrice] = useState(0);
  const [advisorAnswer, setAdvisorAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRfq(loadLastRfq(user.username));
  }, [user.username]);

  const cg = (rfq?.condiciones_generales || {}) as Record<string, unknown>;
  const items = useMemo(() => rfq?.items || [], [rfq]);
  const counts = getTechnicalCounts(rfq);
  const activeMode = advisorModes.find((item) => item.value === analysisMode) || advisorModes[0];
  const hasRfq = Boolean(rfq && items.length);

  async function runAdvisor() {
    setError(null);
    setCopied(false);
    setLoading(true);
    try {
      const response = await askAdvisor({
        username: user.username,
        cg,
        items: items as Array<Record<string, unknown>>,
        situation,
        mode: analysisMode,
        reference_price: referencePrice
      });
      setAdvisorAnswer(response.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar el asesor.");
    } finally {
      setLoading(false);
    }
  }

  async function runCopilot(nextQuestion = question) {
    if (!nextQuestion.trim()) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: nextQuestion }];
    setMessages(nextMessages);
    setQuestion("");
    setError(null);
    setLoading(true);
    try {
      const response = await askCopilot({
        username: user.username,
        cg,
        items: items as Array<Record<string, unknown>>,
        question: nextQuestion,
        history: nextMessages
      });
      setMessages([...nextMessages, { role: "assistant", content: response.answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar Copilot.");
    } finally {
      setLoading(false);
    }
  }

  async function copyAdvisorAnswer() {
    if (!advisorAnswer.trim()) return;
    await navigator.clipboard.writeText(advisorAnswer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
        <div className="grid gap-0 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="p-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand">
              <Sparkles className="h-3.5 w-3.5" />
              Centro AI operativo
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Asesor de procura y Copilot de licitaciones</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Trabaja sobre el ultimo RFQ analizado. Usa este modulo para negociar, preparar preguntas, revisar riesgos y resolver dudas sin navegar por toda la app.
            </p>
          </div>
          <div className="border-t border-line bg-slate-50 p-5 lg:border-l lg:border-t-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">RFQ activo</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">{getRfqNumber(rfq)}</div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="text-xs text-muted">Renglones</div>
                <div className="mt-1 text-lg font-semibold">{counts.total}</div>
              </div>
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="text-xs text-muted">Prop. tecnica</div>
                <div className="mt-1 text-lg font-semibold">{counts.propuesta}</div>
              </div>
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="text-xs text-muted">Fichas</div>
                <div className="mt-1 text-lg font-semibold">{counts.ficha}</div>
              </div>
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="text-xs text-muted">Obsolescencia</div>
                <div className="mt-1 text-lg font-semibold">{counts.obsoletos}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {!hasRfq && (
        <section className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Primero analiza o abre un RFQ</div>
            <p className="mt-1 leading-6">
              El Centro AI puede responder mejor cuando tiene una matriz de renglones cargada. Puedes seguir usandolo, pero el contexto sera limitado.
            </p>
          </div>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-panel p-3 shadow-sm">
            <button
              onClick={() => setMode("advisor")}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold ${mode === "advisor" ? "bg-brand text-white" : "text-slate-700 hover:bg-slate-50"}`}
            >
              <Target className="h-4 w-4" />
              Agente negociador
            </button>
            <button
              onClick={() => setMode("copilot")}
              className={`mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold ${mode === "copilot" ? "bg-brand text-white" : "text-slate-700 hover:bg-slate-50"}`}
            >
              <Bot className="h-4 w-4" />
              Procura Copilot
            </button>
          </div>

          <div className="rounded-xl border border-line bg-panel p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileText className="h-4 w-4 text-brand" />
              Contexto critico
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Entrega</dt>
                <dd className="mt-1 leading-5">{cleanValue(cg.tiempo_de_entrega_global)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Garantia</dt>
                <dd className="mt-1 leading-5">{cleanValue(cg.garantia_exigida)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Lugar</dt>
                <dd className="mt-1 leading-5">{cleanValue(cg.lugar_de_entrega)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Validez</dt>
                <dd className="mt-1 leading-5">{cleanValue(cg.validez_de_la_oferta)}</dd>
              </div>
            </dl>
          </div>
        </aside>

        {error && <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 xl:col-start-2">{error}</section>}

        {mode === "advisor" ? (
          <section className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
            <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Preparar consulta</div>
                  <p className="mt-1 text-sm leading-6 text-muted">{activeMode.copy}</p>
                </div>
                <MessageSquareText className="h-5 w-5 text-brand" />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {advisorModes.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setAnalysisMode(item.value)}
                    className={`rounded-lg border px-3 py-3 text-left text-sm font-semibold ${
                      analysisMode === item.value ? "border-blue-200 bg-blue-50 text-brand" : "border-line bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <label className="text-sm font-semibold text-slate-900">Situacion o correo del proveedor</label>
                <textarea
                  value={situation}
                  onChange={(event) => setSituation(event.target.value)}
                  placeholder="Pega el correo del proveedor o describe lo que necesitas negociar..."
                  className="mt-2 min-h-52 w-full rounded-lg border border-line bg-white px-3 py-3 text-sm outline-none"
                />
              </div>

              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-900">Plantillas rapidas</div>
                <div className="mt-2 space-y-2">
                  {situationTemplates.map((template) => (
                    <button
                      key={template}
                      onClick={() => setSituation(template)}
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-left text-xs leading-5 text-slate-700 hover:bg-slate-50"
                    >
                      {template}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <label className="text-sm font-semibold text-slate-900">Precio de referencia opcional</label>
                <input
                  type="number"
                  value={referencePrice}
                  onChange={(event) => setReferencePrice(Number(event.target.value))}
                  className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none"
                  placeholder="Ej. 1250"
                />
              </div>

              <button
                onClick={runAdvisor}
                disabled={loading || !situation.trim()}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Generar recomendacion
              </button>
            </div>

            <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Respuesta ejecutiva</div>
                  <p className="mt-1 text-sm text-muted">Lista para revisar, ajustar y usar con proveedores o supervisor.</p>
                </div>
                <button
                  onClick={copyAdvisorAnswer}
                  disabled={!advisorAnswer.trim()}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  <Clipboard className="h-4 w-4" />
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <div className="mt-4 min-h-[560px] whitespace-pre-wrap rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-slate-800">
                {formatAnswer(advisorAnswer)}
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Bot className="h-4 w-4 text-brand" />
                  Chat de licitacion {getRfqNumber(rfq)}
                </div>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Haz preguntas concretas sobre requisitos, riesgos, renglones, entrega, garantia y estrategia.
                </p>
              </div>
              <button
                onClick={() => setMessages([])}
                disabled={!messages.length}
                className="h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                Limpiar chat
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {copilotQuestions.map((quickQuestion) => (
                <button
                  key={quickQuestion}
                  onClick={() => void runCopilot(quickQuestion)}
                  disabled={loading}
                  className="rounded-full border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {quickQuestion}
                </button>
              ))}
            </div>

            <div className="mt-4 min-h-[460px] space-y-3 rounded-lg border border-line bg-slate-50 p-4">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`rounded-lg p-3 text-sm leading-6 ${
                    message.role === "user" ? "ml-auto max-w-2xl bg-blue-50 text-blue-900" : "mr-auto max-w-3xl bg-white text-slate-800"
                  }`}
                >
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {message.role === "user" ? "Tu consulta" : "Procura Copilot"}
                  </div>
                  <div className="whitespace-pre-wrap">{message.content}</div>
                </div>
              ))}
              {!messages.length && (
                <div className="grid min-h-[390px] place-items-center text-center text-sm text-muted">
                  <div>
                    <Bot className="mx-auto mb-3 h-8 w-8 text-brand" />
                    Selecciona una pregunta rapida o escribe una consulta especifica del RFQ.
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runCopilot();
                }}
                placeholder="Pregunta algo del RFQ..."
                className="h-11 flex-1 rounded-lg border border-line bg-white px-3 text-sm outline-none"
              />
              <button
                onClick={() => void runCopilot()}
                disabled={loading || !question.trim()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
