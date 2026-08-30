import type { ElementType } from "react";

// O Reader reutiliza este componente; a lista única evita divergência entre
// o botão histórico e a variante opt-in da Library.
const BASE_ACTION_BUTTON_CLASSES = "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-button transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary";

export interface EmptyStateProps {
  icon?: ElementType;
  iconClassName?: string;
  illustration?: {
    src: string;
    alt: string;
  };
  title: string;
  titleClassName?: string;
  description: string;
  verticalPosition?: "centered" | "raised";
  surfaceMarker?: "action";
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
  };
}

// Estado vazio neutro e reutilizavel. O visual chega como icone ou ilustracao;
// o EmptyState nao decide cor por estado nem desenha SVG proprio.
export function EmptyState({ icon: Icon, iconClassName, illustration, title, titleClassName, description, verticalPosition = "centered", surfaceMarker, action }: EmptyStateProps) {
  return (
    <div className={`flex h-full flex-col items-center justify-center p-12 text-center ${verticalPosition === "raised" ? "-translate-y-7" : ""}`}>
      {illustration ? <img src={illustration.src} alt={illustration.alt} className="h-12 w-12 opacity-70" /> : null}
      {!illustration && Icon ? <Icon aria-hidden className={iconClassName ?? "h-12 w-12 text-text-secondary"} /> : null}
      <h2 className={`mt-3 font-sans text-base font-semibold ${titleClassName ?? "text-text-primary"}`}>{title}</h2>
      <p className="mt-1 font-sans text-sm font-normal text-text-secondary">{description}</p>
      {action ? (
        <span className="mt-4 inline-flex" title={action.title}>
          <button
            type="button"
            data-glass-backdrop={surfaceMarker === "action" ? "action" : undefined}
            onClick={action.onClick}
            disabled={action.disabled}
            className={surfaceMarker ? `material-surface-action ${BASE_ACTION_BUTTON_CLASSES}` : BASE_ACTION_BUTTON_CLASSES}
          >
            {action.label}
          </button>
        </span>
      ) : null}
    </div>
  );
}
