// Dimensoes do painel de Caderno num modulo proprio, mesmo padrao de
// canvasPanelDimensions.ts — aqui a motivacao e so organizacional (o
// NotebookPanel nao e lazy-loaded como o CanvasPanel, entao nao ha risco de
// puxar um chunk pesado sem querer); mantem os dois paineis consistentes e da
// ao LibraryView um lugar unico para ler a largura sem importar o componente
// inteiro.
//
// O layout de 3 colunas (paginas | editor | detalhes) precisa de bem mais
// espaco horizontal que o antigo layout de coluna unica — por isso o salto de
// 520 para ~1680.
export const notebookPanelWidth = 1680;
export const notebookPanelHeight = 760;
export const notebookPanelMinWidth = 640;
export const notebookPanelMinHeight = 440;

// Largura fixa da coluna de Paginas (a coluna do meio, do editor, e quem
// flexiona). A coluna de Detalhes nao entra nesse calculo: ela e sempre um
// drawer overlay, sem reflow, entao sua largura nao disputa espaco com as
// demais colunas.
export const notebookPagesColumnWidth = 260;
export const notebookDetailsColumnWidth = 360;
