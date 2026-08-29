type InfoDialogProps = {
  title: string;
  message: string;
  actionLabel?: string;
  onDismiss: () => void;
};

export function InfoDialog({
  title,
  message,
  actionLabel = "Entendi",
  onDismiss,
}: InfoDialogProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay-modal p-6" role="presentation" onMouseDown={onDismiss}>
      <section
        className="material-surface-overlay w-full max-w-md rounded-xl bg-surface-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-border-subtle px-6 py-5">
          <h2 id="info-dialog-title" className="text-lg font-bold text-text-primary">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{message}</p>
        </header>

        <footer className="flex justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
            onClick={onDismiss}
          >
            {actionLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
