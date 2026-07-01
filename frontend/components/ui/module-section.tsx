import { memo, HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export const ModuleSection = memo(function ModuleSection({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("rounded-xl border border-line bg-panel p-5 shadow-sm", className)}
      {...props}
    />
  );
});
