import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = {
  label: string;
  children: ReactNode;
  variant?: "ghost" | "selected" | "danger" | "primary" | "accent";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">;

const variantClassName: Record<NonNullable<IconButtonProps["variant"]>, string> = {
  ghost: "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
  selected: "bg-surface-panel text-primary-text shadow-sm",
  danger: "text-text-subtle hover:bg-status-red hover:text-status-red-text",
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover shadow-button",
  accent: "text-primary-text hover:bg-primary-soft",
};

export function IconButton({ label, children, variant = "ghost", type = "button", ...buttonProps }: IconButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 transition ${variantClassName[variant]}`}
    >
      {children}
    </button>
  );
}
