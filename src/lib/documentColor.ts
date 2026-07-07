// Geracao de cor deterministica no cliente (sem dados novos no banco).
//
// - Capa do documento: hue derivado do proprio documento; saturacao e
//   luminosidade mudam por tema via CSS.
// - Dot da colecao: cor mais saturada derivada do nome da colecao, usada como
//   indicador na sidebar. NAO e "cor livre do usuario"; e estavel por colecao
//   ate existir um campo de cor no modelo.

// Hash FNV-1a de 32 bits, deterministico e bem distribuido para strings curtas.
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

export function deriveCoverHue(seed: string): number {
  return hueFromSeed(seed);
}

// Dot da colecao: pequeno e saturado, precisa se destacar na sidebar em ambos
// os temas.
export function deriveCollectionColor(name: string): string {
  return `hsl(${hueFromSeed(name)} 55% 52%)`;
}
