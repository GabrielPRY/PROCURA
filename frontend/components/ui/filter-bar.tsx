import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("app-filter-bar flex flex-wrap items-center gap-2 p-2", className)}>{children}</div>;
}

export function FilterPill({ active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "app-filter-pill inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-semibold transition",
        active ? "app-filter-pill-active" : "app-filter-pill-idle",
        className
      )}
      {...props}
    />
  );
}
