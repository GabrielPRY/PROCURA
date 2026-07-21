import { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export function PageHeader({
  eyebrow,
  title,
  copy,
  actions,
  className
}: {
  eyebrow?: string;
  title?: string;
  copy?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="app-eyebrow">{eyebrow}</div> : null}
        {title ? <h2 className="mt-1 text-xl font-semibold text-ink">{title}</h2> : null}
        {copy ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{copy}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
