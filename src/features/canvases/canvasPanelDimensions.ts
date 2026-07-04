// Dimensoes do painel de Quadro num modulo proprio, SEM importar nada do
// CanvasPanel: o LibraryView precisa delas para calcular a posicao inicial
// centralizada ANTES de abrir o painel, e importar qualquer coisa de
// CanvasPanel.tsx criaria dependencia estatica do modulo que carrega o
// Excalidraw — quebrando o lazy-load do chunk (~2MB) que hoje so baixa
// quando o primeiro quadro e aberto.
export const canvasPanelWidth = 900;
export const canvasPanelHeight = 640;
export const canvasPanelMinWidth = 520;
export const canvasPanelMinHeight = 420;
