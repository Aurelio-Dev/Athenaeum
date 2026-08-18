import { TAG_COLOR_TOKENS, type TagColorPair, type TagColorToken } from "../../lib/tagColors";
import type { CanvasFillStyle } from "./canvasScene";
import type { CanvasPropertiesSections } from "./canvasPropertiesSections";

type CanvasPropertiesPanelProps = {
  sections: CanvasPropertiesSections;
  color: string;
  strokeWidth: number;
  fillStyle: CanvasFillStyle;
  onColorChange: (color: string) => void;
  onStrokeWidthChange: (strokeWidth: number) => void;
  onFillStyleChange: (fillStyle: CanvasFillStyle) => void;
};

const colorEntries = Object.entries(TAG_COLOR_TOKENS) as [TagColorToken, TagColorPair][];
const strokeOptions = [
  { label: "S", value: 1 },
  { label: "M", value: 2 },
  { label: "L", value: 4 },
  { label: "XL", value: 8 },
] as const;
const fillOptions: readonly { label: string; value: CanvasFillStyle }[] = [
  { label: "Nenhum", value: "none" },
  { label: "Sólido", value: "solid" },
  { label: "Hachurado", value: "hachure" },
  { label: "Cruzado", value: "cross-hatch" },
];

function isSameColor(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase();
}

function FillStyleIcon({ style }: { style: CanvasFillStyle }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" fill={style === "solid" ? "currentColor" : "none"} />
      {style === "none" ? <line x1="5" y1="19" x2="19" y2="5" /> : null}
      {style === "hachure" || style === "cross-hatch" ? (
        <>
          <line x1="5" y1="11" x2="11" y2="5" />
          <line x1="5" y1="17" x2="17" y2="5" />
          <line x1="7" y1="19" x2="19" y2="7" />
          <line x1="13" y1="19" x2="19" y2="13" />
        </>
      ) : null}
      {style === "cross-hatch" ? (
        <>
          <line x1="5" y1="7" x2="17" y2="19" />
          <line x1="5" y1="13" x2="11" y2="19" />
          <line x1="11" y1="5" x2="19" y2="13" />
        </>
      ) : null}
    </svg>
  );
}

export function CanvasPropertiesPanel({
  sections,
  color,
  strokeWidth,
  fillStyle,
  onColorChange,
  onStrokeWidthChange,
  onFillStyleChange,
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

      {sections.preenchimento ? (
        <section className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--floating-header-control)]">
            Preenchimento
          </h3>
          <div className="grid grid-cols-4 gap-1.5">
            {fillOptions.map((option) => {
              const active = fillStyle === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-label={`Preenchimento ${option.label}`}
                  title={option.label}
                  aria-pressed={active}
                  onClick={() => onFillStyleChange(option.value)}
                  className={`flex h-9 items-center justify-center rounded-lg border transition ${
                    active
                      ? "border-[var(--accent)] bg-[var(--color-accent-tint-bg)] text-[var(--accent)]"
                      : "border-[var(--color-border-subtle)] text-[var(--floating-header-control)] hover:bg-[var(--floating-header-hover-bg)]"
                  }`}
                >
                  <FillStyleIcon style={option.value} />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
