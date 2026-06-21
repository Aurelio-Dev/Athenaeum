import type { ReactNode } from "react";

type ConfirmationDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "primary",
  children,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const confirmClassName =
    tone === "danger"
      ? "bg-status-red text-status-red-text hover:brightness-95"
      : "bg-primary text-text-inverse shadow-button hover:bg-primary-hover";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay-modal p-6" role="presentation" onMouseDown={onCancel}>
      <section
        className="w-full max-w-md rounded-xl bg-surface-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-border-subtle px-6 py-5">
          <h2 id="confirmation-dialog-title" className="text-lg font-bold text-text-primary">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p>
        </header>

        {children ? <div className="px-6 py-4 text-sm text-text-secondary">{children}</div> : null}

        <footer className="flex justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button type="button" className="rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-muted" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`rounded-lg px-4 py-2 text-sm font-bold transition ${confirmClassName}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
