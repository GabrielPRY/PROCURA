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
    <div className={cn("app-empty-state grid min-h-32 place-items-center p-6 text-center", className)}>
      <div>
        {Icon ? <Icon className="mx-auto h-8 w-8 text-brand" /> : null}
        <div className="mt-3 text-sm font-semibold text-ink">{title}</div>
        {copy ? <p className="mt-1 max-w-md text-sm leading-6 text-muted">{copy}</p> : null}
      </div>
    </div>
  );
}
