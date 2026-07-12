// Estimativa de tamanho do arquivo de exportacao, calculada ANTES da gravacao.
//
// O export final e um unico HTML autocontido: o corpo (texto, CSS, fontes Lora
// e KaTeX, SVGs de diagramas) ja esta inteiro no HTML montado pelo builder; o
// que ainda nao esta la sao os binarios de imagens (notebook_assets) e anexos
// (notebook_file_attachments), representados por sentinelas leves que o Rust
// troca por data URIs em base64 na hora de escrever.
//
// Por isso a estimativa e:
//   tamanho ~= bytes do HTML montado + bytes dos recursos em base64
//
// base64 infla os bytes crus em ~4/3 (cada 3 bytes viram 4 caracteres). A
// aproximacao ignora dois termos pequenos de sinais opostos: as molduras
// `data:<mime>;base64,` / `<img>` / `<a>` (somam) e as sentinelas de comentario
// que somem (subtraem). O erro liquido fica bem abaixo de 1%, por isso o valor
// e sempre rotulado como aproximado na interface.

// Limiar de aviso: 100 MiB. Usa a mesma base 1024 do formatExportFileSize do
// painel, para o numero exibido ("100.0 MB") bater com o limiar comparado.
export const notebookExportSizeWarningThresholdBytes = 100 * 1024 * 1024;

export type NotebookExportSizeEstimateInput = {
  // Tamanho em BYTES (UTF-8) do HTML montado pelo builder de preparacao. Nao e
  // o length da string em JS: caracteres nao-ASCII ocupam mais de 1 byte, entao
  // o chamador deve medir com TextEncoder, nao com String.length.
  htmlByteLength: number;
  // Soma de file_size (bytes crus em disco) de todos os assets e anexos das
  // paginas no escopo do export.
  resourceBytes: number;
};

// Bytes que `resourceBytes` ocupara depois de virar base64 no HTML final.
function base64EncodedLength(rawBytes: number) {
  if (rawBytes <= 0) {
    return 0;
  }

  // 4 caracteres a cada bloco de 3 bytes, arredondando o bloco final para cima
  // (o padding "=" preenche o resto). Aproxima Sigma(por recurso) por um unico
  // arredondamento sobre o total: a diferenca e de poucos bytes por recurso.
  return Math.ceil(rawBytes / 3) * 4;
}

export function estimateNotebookExportSizeBytes(input: NotebookExportSizeEstimateInput): number {
  const htmlByteLength = Math.max(0, input.htmlByteLength);
  return htmlByteLength + base64EncodedLength(input.resourceBytes);
}

export function isNotebookExportSizeAboveThreshold(estimateBytes: number): boolean {
  return estimateBytes > notebookExportSizeWarningThresholdBytes;
}

// Decide se o export deve passar pelo gate de confirmacao de tamanho, dado o
// resultado da estimativa (ou null, quando o calculo falhou).
//
// Fail-safe, nao fail-open: estimativa DESCONHECIDA (null) ativa o gate tanto
// quanto uma estimativa acima do limiar. Um gate de seguranca nao deve falhar
// aberto em silencio — "nao consegui medir" pode significar "o caderno e
// anormalmente grande", justamente o caso em que o aviso mais importa. Abaixo
// do limiar e com valor conhecido, libera sem friccao.
export function shouldGateNotebookExportSize(estimateBytes: number | null): boolean {
  return estimateBytes === null || isNotebookExportSizeAboveThreshold(estimateBytes);
}
