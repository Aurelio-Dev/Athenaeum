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

// Larguras fixas das colunas laterais (a coluna do meio, do editor, e quem
// flexiona). Mesmos valores usados no calculo do breakpoint abaixo.
export const notebookPagesColumnWidth = 260;
export const notebookDetailsColumnWidth = 320;
export const notebookEditorMinWidth = 600;

// Abaixo desta largura de PAINEL (nao de janela), a coluna de Detalhes some
// atras do botao de toggle no header — sem isso, o espaco que sobra para o
// editor ficaria apertado demais. 240 (paginas) + 320 (detalhes) + ~500
// (minimo confortavel para o editor com toolbar) arredondado.
export const notebookDetailsCollapseBreakpoint = notebookPagesColumnWidth + notebookDetailsColumnWidth + notebookEditorMinWidth;
