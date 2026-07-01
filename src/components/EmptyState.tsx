import type { ElementType } from "react";

export interface EmptyStateProps {
  icon: ElementType;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// Estado vazio neutro e reutilizavel. O icone chega como componente via prop
// (ElementType) — o EmptyState nao decide cor por estado nem desenha SVG proprio.
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-12 text-center">
      <Icon aria-hidden className="h-12 w-12 text-text-secondary" />
      <h2 className="mt-3 text-base font-medium text-text-primary">{title}</h2>
      <p className="mt-1 text-sm text-text-secondary">{description}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
