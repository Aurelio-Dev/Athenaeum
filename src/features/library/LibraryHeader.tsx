import type { ReactNode } from "react";

type LibraryHeaderProps = {
  title: string;
  // Texto de contagem ja formatado pelo chamador ("7 itens", "4 cadernos") —
  // o header nao conhece o substantivo da aba ativa.
  countText: string;
  // Descricao da colecao — renderiza so quando vier preenchida.
  description?: string;
  // Abas pill (Documentos/Cadernos/Quadros) em rotas de colecao; ausente nas
  // rotas globais.
  tabs?: ReactNode;
  // Presente apenas em rotas de colecao: mostra o lapis ao lado do titulo
  // para editar nome/descricao/cor.
  onEdit?: () => void;
};

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export function LibraryHeader({ title, countText, description, tabs, onEdit }: LibraryHeaderProps) {
  return (
    <div className="min-w-64 flex-1">
      <div className="flex items-center gap-3">
        {/* Titulo em Lora Bold (font-serif), 42 / line-height 46.2 / #2C1810 no
            claro; no escuro mantem o text-primary (tom claro). O tracking
            -1.26px da spec original valia para Segoe UI — em serif apertava
            demais, entao foi removido de proposito.
            py-1.5: o leading 46.2 e mais apertado que a caixa de linha natural
            da fonte a 42px, entao com o overflow:hidden do `truncate` os glifos
            com ascendente/descendente seriam cortados verticalmente; pr-1 evita
            recorte do ultimo glifo na borda direita. */}
        <h1 className="truncate py-1.5 pr-1 font-serif text-[42px] font-bold leading-[46.2px] text-[#2C1810] dark:text-[#F0E8DF]">{title}</h1>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-panel text-text-secondary shadow-sm transition hover:text-text-primary"
            aria-label="Editar coleção"
            title="Editar coleção"
          >
            <PencilIcon />
          </button>
        ) : null}
      </div>
      {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      {tabs ? <div className="mt-4">{tabs}</div> : null}
      <p className={`${tabs ? "mt-5" : "mt-2"} text-[13px] font-semibold leading-[19.5px] text-text-secondary`}>{countText}</p>
    </div>
  );
}
