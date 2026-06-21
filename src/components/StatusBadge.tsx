import { statusTokens } from "../styles/designTokens";
import type { DocumentStatus } from "../types/library";

type StatusBadgeProps = {
  status: DocumentStatus;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const token = statusTokens[status];

  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${token.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${token.dotClassName}`} />
      {token.label}
    </span>
  );
}
