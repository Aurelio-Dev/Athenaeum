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
    <div>
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
      </div>

      {onRemove ? (
        <>
          <div className="my-1 h-px bg-border-subtle" />
          <button
            type="button"
            className="block w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRemove}
          >
            {removeLabel}
          </button>
        </>
      ) : null}
    </div>
  );
}
