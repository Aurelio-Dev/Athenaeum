// Abas pill de uma colecao: Documentos / Cadernos / Quadros.
// Renderizadas apenas em rotas de colecao — cadernos e quadros pertencem
// obrigatoriamente a uma colecao (FK NOT NULL), entao as rotas globais
// (Todos os itens, Recentes, Favoritos, Lixeira) nao exibem abas.
export type CollectionTab = "documents" | "notebooks" | "canvases";

const tabs: Array<{ id: CollectionTab; label: string }> = [
  { id: "documents", label: "Documentos" },
  { id: "notebooks", label: "Cadernos" },
  { id: "canvases", label: "Quadros" },
];

type CollectionTabsProps = {
  activeTab: CollectionTab;
  onTabChange: (tab: CollectionTab) => void;
};

export function CollectionTabs({ activeTab, onTabChange }: CollectionTabsProps) {
  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Conteúdo da coleção">
      {tabs.map(({ id, label }) => {
        const active = id === activeTab;

        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(id)}
            className={`rounded-full px-4 py-2 text-[13px] leading-[19.5px] transition ${
              active
                ? "bg-primary font-bold text-text-inverse"
                : "font-normal text-text-secondary hover:bg-surface-muted hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
