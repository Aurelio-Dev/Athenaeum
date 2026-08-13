import {
  TAG_COLOR_TOKEN_NAMES,
  TAG_COLOR_TOKENS,
  type TagColorToken,
} from "../../lib/tagColors";

type TagColorPickerProps = {
  selectedToken: TagColorToken | null;
  onSelect: (token: TagColorToken) => void;
  appearance?: "solid" | "pastel";
  ariaLabelPrefix?: string;
  onRemove?: () => void;
  removeLabel?: string;
  compact?: boolean;
};

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function TagColorPicker({
  selectedToken,
  onSelect,
  appearance = "solid",
  ariaLabelPrefix = "Selecionar cor",
  onRemove,
  removeLabel = "Remover cor",
  compact = false,
}: TagColorPickerProps) {
  return (
    <div className={compact ? "grid grid-cols-5 place-items-center gap-1" : "flex flex-wrap items-center gap-4"}>
      {TAG_COLOR_TOKEN_NAMES.map((token) => {
        const selected = token === selectedToken;
        const colors = TAG_COLOR_TOKENS[token];

        return (
          <button
            key={token}
            type="button"
            className={`flex items-center justify-center rounded-full transition hover:scale-105 ${compact ? "h-8 w-8" : "h-9 w-9"}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(token)}
            aria-label={`${ariaLabelPrefix} ${token}`}
            aria-pressed={selected}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full ${
                selected ? "ring-2 ring-white ring-offset-2 ring-offset-surface-panel" : ""
              }`}
              style={{
                backgroundColor: appearance === "pastel" ? colors.pastel : colors.bg,
                color: appearance === "pastel" ? colors.bg : colors.text,
              }}
            >
              {selected ? <CheckIcon /> : null}
            </span>
          </button>
        );
      })}

      {onRemove ? (
        <button
          type="button"
          className={`flex items-center justify-center rounded-full transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel ${compact ? "h-8 w-8" : "h-9 w-9"}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRemove}
          aria-label={removeLabel}
        >
          <span
            className="relative flex h-5 w-5 overflow-hidden rounded-full border border-[var(--color-text-secondary)] bg-[var(--card)]"
            aria-hidden="true"
          >
            <span className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-[var(--color-text-secondary)]" />
          </span>
        </button>
      ) : null}
    </div>
  );
}
