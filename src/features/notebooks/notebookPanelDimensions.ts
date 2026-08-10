// Dimensoes internas do layout do Caderno, num modulo proprio (mesmo padrao de
// canvasPanelDimensions.ts).
//
// O tamanho da JANELA nao mora mais aqui: o Caderno abre como janela nativa do
// SO e quem define largura/altura/minimos e o comando Rust open_notebook_window
// (src-tauri/src/lib.rs), no builder da WebviewWindow.

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
