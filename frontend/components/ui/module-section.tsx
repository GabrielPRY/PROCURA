import { memo, HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export const ModuleSection = memo(function ModuleSection({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("app-surface p-5", className)}
      {...props}
    />
  );
});
