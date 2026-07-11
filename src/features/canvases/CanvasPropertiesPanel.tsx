import { TAG_COLOR_TOKENS, type TagColorPair, type TagColorToken } from "../../lib/tagColors";
import type { CanvasPropertiesSections } from "./canvasPropertiesSections";

type CanvasPropertiesPanelProps = {
  sections: CanvasPropertiesSections;
  color: string;
  strokeWidth: number;
  onColorChange: (color: string) => void;
  onStrokeWidthChange: (strokeWidth: number) => void;
};

const colorEntries = Object.entries(TAG_COLOR_TOKENS) as [TagColorToken, TagColorPair][];
const strokeOptions = [
  { label: "S", value: 1 },
  { label: "M", value: 2 },
  { label: "L", value: 4 },
  { label: "XL", value: 8 },
] as const;

function isSameColor(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase();
}

export function CanvasPropertiesPanel({
  sections,
  color,
  strokeWidth,
  onColorChange,
  onStrokeWidthChange,
}: CanvasPropertiesPanelProps) {
  return (
    <aside
      aria-label="Propriedades do desenho"
      className="pointer-events-auto absolute right-4 top-4 z-20 w-[200px] rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--card)] p-3 text-[var(--card-foreground)] shadow-[0_10px_28px_-8px_rgba(60,36,20,0.35)]"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {sections.cor ? (
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--floating-header-control)]">
            Cor
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {colorEntries.map(([token, pair]) => {
              const active = isSameColor(color, pair.bg);
              return (
                <button
                  key={token}
                  type="button"
                  aria-label={`Cor ${token}`}
                  title={token}
                  aria-pressed={active}
                  onClick={() => onColorChange(pair.bg)}
                  className={`h-8 rounded-lg border-2 transition ${
                    active
                      ? "border-[var(--accent)] ring-2 ring-[var(--color-accent-tint-bg)]"
                      : "border-transparent hover:border-[var(--color-border-subtle)]"
                  }`}
                  style={{ backgroundColor: pair.bg }}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {sections.traco ? (
        <section className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--floating-header-control)]">
            Traço
          </h3>
          <div className="grid grid-cols-4 gap-1.5">
            {strokeOptions.map((option) => {
              const active = strokeWidth === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-label={`Traço ${option.label}, ${option.value}px`}
                  title={`${option.value}px`}
                  aria-pressed={active}
                  onClick={() => onStrokeWidthChange(option.value)}
                  className={`h-8 rounded-lg border text-xs font-bold transition ${
                    active
                      ? "border-[var(--accent)] bg-[var(--color-accent-tint-bg)] text-[var(--accent)]"
                      : "border-[var(--color-border-subtle)] text-[var(--floating-header-control)] hover:bg-[var(--floating-header-hover-bg)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* A secao Preenchimento sera inserida na Fase 4B-2. */}
    </aside>
  );
}
