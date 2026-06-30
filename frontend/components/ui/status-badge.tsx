import { HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";
import type { Tone } from "@/lib/ui/tones";

const tones: Record<Tone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  info: "border-blue-200 bg-blue-50 text-brand"
};

export function StatusBadge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold leading-4", tones[tone], className)} {...props} />;
}
