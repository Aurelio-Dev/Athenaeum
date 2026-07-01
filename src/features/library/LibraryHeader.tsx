type LibraryHeaderProps = {
  title: string;
  count: number;
  // Descricao da colecao. Opcional ate a migracao do modal "Nova Colecao"
  // adicionar o campo no banco — renderiza so quando vier preenchida.
  description?: string;
};

export function LibraryHeader({ title, count, description }: LibraryHeaderProps) {
  return (
    <div className="min-w-64 flex-1">
      <h1 className="truncate text-[32px] font-bold leading-tight tracking-tight text-text-primary">{title}</h1>
      {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      <p className="mt-2 text-sm text-text-secondary">
        {count} {count === 1 ? "item" : "itens"}
      </p>
    </div>
  );
}
