import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";

export function EmptyState({
  title,
  copy,
  icon: Icon,
  className
}: {
  title: string;
  copy?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("grid min-h-32 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center", className)}>
      <div>
        {Icon ? <Icon className="mx-auto h-8 w-8 text-brand" /> : null}
        <div className="mt-3 text-sm font-semibold text-slate-950">{title}</div>
        {copy ? <p className="mt-1 max-w-md text-sm leading-6 text-muted">{copy}</p> : null}
      </div>
    </div>
  );
}
