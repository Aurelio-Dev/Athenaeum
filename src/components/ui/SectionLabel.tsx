import type { ReactNode } from "react";

// Rotulo de secao em caixa alta, extraido do padrao ja repetido no app (ex.:
// DocumentDetailsPanel). Centraliza o estilo de agrupamento — caixa alta,
// peso semibold, tracking largo, cor de texto discreta — num unico lugar para
// as varias secoes que o usam (painel de detalhes, SettingsPanel, etc.).
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-widest text-text-subtle">{children}</p>;
}
