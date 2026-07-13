import { getSubjectTagTone, toneClassNames } from "../styles/designTokens";
import type { SubjectTag } from "../types/library";

type TagBadgeProps = {
  tag: SubjectTag;
  size?: "default" | "compact";
  // Quando presente, o chip ganha um "×" interno para remover a tag (editor de
  // tags do leitor). Ausente = chip somente leitura, como antes.
  onRemove?: () => void;
};

export function TagBadge({ tag, size = "default", onRemove }: TagBadgeProps) {
  const tone = getSubjectTagTone(tag);
  const sizeClassName = size === "compact" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  return (
    <span className={`inline-flex max-w-full items-center rounded-full font-semibold ${sizeClassName} ${toneClassNames[tone].badge}`}>
      <span className="truncate">{tag}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remover tag ${tag}`}
          title={`Remover tag ${tag}`}
          className="ml-1 -mr-0.5 inline-flex shrink-0 items-center justify-center rounded-full leading-none opacity-70 transition hover:opacity-100"
          onClick={onRemove}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <line x1="18" x2="6" y1="6" y2="18" />
            <line x1="6" x2="18" y1="6" y2="18" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}
