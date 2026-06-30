import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-line bg-slate-50 p-2", className)}>{children}</div>;
}

export function FilterPill({ active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition",
        active ? "border-blue-200 bg-blue-50 text-brand" : "border-transparent bg-white text-slate-700 hover:border-blue-200 hover:text-brand",
        className
      )}
      {...props}
    />
  );
}
