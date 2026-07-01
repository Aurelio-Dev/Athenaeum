// Geracao de cor deterministica no cliente (sem dados novos no banco).
//
// - Capa do documento: tom suave/quente derivado do proprio documento, usado
//   como fundo da thumbnail no card do grid.
// - Dot da colecao: cor mais saturada derivada do nome da colecao, usada como
//   indicador na sidebar. NAO e "cor livre do usuario" — e estavel por colecao
//   ate existir um campo de cor no modelo (migracao do modal "Nova Colecao").

// Hash FNV-1a de 32 bits — determinista e bem distribuido para strings curtas.
function hashString(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function hueFromSeed(seed: string): number {
  return hashString(seed) % 360;
}

// Fundo da capa: baixa saturacao + alta luminosidade → pastel suave que combina
// com o fundo creme. O texto do card fica ABAIXO da thumbnail, entao a capa so
// precisa contrastar com o coracao (fundo branco) e a barra de progresso.
export function deriveCoverColor(seed: string): string {
  return `hsl(${hueFromSeed(seed)} 34% 80%)`;
}

// Dot da colecao: pequeno e saturado, precisa se destacar na sidebar em ambos
// os temas — saturacao alta e luminosidade media.
export function deriveCollectionColor(name: string): string {
  return `hsl(${hueFromSeed(name)} 55% 52%)`;
}
