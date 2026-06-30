import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/ui/cn";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
  primary: "border-brand bg-brand text-white shadow-sm hover:bg-brand-dark",
  secondary: "border-line bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-brand",
  danger: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
  ghost: "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900"
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-xs",
  md: "h-10 px-3 text-sm",
  lg: "h-11 px-4 text-sm",
  icon: "h-10 w-10 px-0 text-sm"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
});
