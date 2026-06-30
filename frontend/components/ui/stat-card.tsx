import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  className
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-line bg-panel p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
        {Icon ? <Icon className="h-4 w-4 text-brand" /> : null}
      </div>
      <div className="mt-2 truncate text-xl font-semibold text-slate-950">{String(value)}</div>
      {hint ? <div className="mt-1 text-xs leading-5 text-muted">{hint}</div> : null}
    </div>
  );
}
