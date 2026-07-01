import { memo } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";

export const StatCard = memo(function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading = false,
  className
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  /** When true, renders an animated skeleton instead of real data */
  loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={cn("rounded-xl border border-line bg-panel p-4 shadow-sm", className)}>
        <div className="flex items-center justify-between gap-3">
          <span className="app-skeleton h-3 w-20" />
          <span className="app-skeleton h-4 w-4 rounded" />
        </div>
        <span className="app-skeleton mt-3 block h-6 w-28" />
        <span className="app-skeleton mt-2 block h-3 w-32" />
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-line bg-panel p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
        {Icon ? <Icon className="h-4 w-4 text-brand" /> : null}
      </div>
      <div className="mt-2 truncate text-xl font-semibold text-slate-950 dark:text-white">{String(value)}</div>
      {hint ? <div className="mt-1 text-xs leading-5 text-muted">{hint}</div> : null}
    </div>
  );
});
