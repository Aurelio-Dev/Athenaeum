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

// Trilho de Paginas (esquerda): nasce colapsado mostrando so os dots das
// paginas e expande revelando os titulos ao lado. A largura muda com reflow
// real (o editor, flex-1, encolhe), diferente do drawer de Detalhes que
// sobrepoe. O estado colapsado/expandido e local e efemero (nao persiste),
// entao nao ha uma largura "padrao aberta" persistida.
export const notebookPagesRailCollapsedWidth = 54;
export const notebookPagesRailExpandedWidth = 214;

// A coluna de Detalhes nao entra em nenhum calculo de largura: ela e sempre um
// drawer overlay, sem reflow, entao sua largura nao disputa espaco com as
// demais colunas.
export const notebookDetailsColumnWidth = 360;
