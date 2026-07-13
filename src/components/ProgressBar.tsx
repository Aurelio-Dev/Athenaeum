type ProgressBarProps = {
  value: number;
  // false quando o percentual ja aparece em outro lugar do bloco (ex.: o card
  // de status de leitura mostra o valor na linha de cima).
  showValue?: boolean;
};

export function ProgressBar({ value, showValue = true }: ProgressBarProps) {
  const normalizedValue = Math.min(100, Math.max(0, value));

  return (
    <div className="flex w-full items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-subtle">
        <div className="h-full rounded-full bg-primary" style={{ width: `${normalizedValue}%` }} />
      </div>
      {showValue ? (
        <span className="min-w-10 text-right text-xs tabular-nums text-text-secondary">{normalizedValue}%</span>
      ) : null}
    </div>
  );
}
