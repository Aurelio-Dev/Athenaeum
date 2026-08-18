import type { ReactNode } from "react";

// Controle segmentado generico (estilo "pill"): um grupo de opcoes mutuamente
// exclusivas, uma ativa por vez. Generico no valor (T extends string) para
// reuso — o primeiro uso concreto e o seletor de tema no SettingsPanel, mas
// nada aqui e especifico dele.
export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  // Rotulo acessivel do grupo (o container e um radiogroup).
  ariaLabel?: string;
};

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full border border-border-subtle p-1"
    >
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              isActive ? "bg-primary text-white" : "bg-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
