import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/ui/cn";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
  primary: "app-btn app-btn-primary",
  secondary: "app-btn app-btn-secondary",
  danger: "app-btn app-btn-danger",
  ghost: "app-btn app-btn-quiet"
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
        "inline-flex shrink-0 items-center justify-center gap-2 border font-semibold transition duration-150 disabled:cursor-not-allowed disabled:shadow-none focus-visible:outline-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
});
