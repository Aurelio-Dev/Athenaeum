/**
 * Mapeamento de palavras-chave de tag → token de cor.
 *
 * Regras:
 * - Nunca adicionar um hex novo — usar sempre um dos 9 tokens existentes.
 * - A mesma palavra-chave usa sempre o mesmo token em todas as telas.
 * - Green, Slate e Red são reservados para badges de STATUS (Concluído,
 *   Não iniciado, Erro) — nunca usar para tags de assunto.
 * - Todos os pares foram validados em WCAG AA (mínimo 4.5:1).
 *   Pior caso: Red a 6.47:1 (texto branco sobre fundo sólido).
 *
 * Referência: athenaeum-design-tokens-cores.md
 */

export const TAG_COLOR_TOKEN_NAMES = [
  'violet',
  'indigo',
  'blue',
  'teal',
  'green',
  'amber',
  'rose',
  'red',
  'slate',
] as const;

export type TagColorToken = (typeof TAG_COLOR_TOKEN_NAMES)[number];

/** Par bg/texto para pílula de tag em fill sólido (padrão de produção). */
export interface TagColorPair {
  bg:     string; // fundo saturado / cor de texto para destaques inline
  pastel: string; // fundo claro da paleta pastel
  text:   string; // sempre #FFFFFF nas pilulas solidas
}

/** Os 9 tokens de cor do design system. */
export const TAG_COLOR_TOKENS: Record<TagColorToken, TagColorPair> = {
  violet: { bg: '#5B21B6', pastel: '#EDE9FE', text: '#FFFFFF' }, // 8.98:1
  indigo: { bg: '#4338CA', pastel: '#E0E7FF', text: '#FFFFFF' }, // 7.90:1
  blue:   { bg: '#1D4ED8', pastel: '#DBEAFE', text: '#FFFFFF' }, // 6.70:1
  teal:   { bg: '#0D5C54', pastel: '#CCFBF1', text: '#FFFFFF' }, // 7.85:1
  green:  { bg: '#036B4D', pastel: '#D1FAE5', text: '#FFFFFF' }, // 6.53:1 — STATUS apenas para tags
  amber:  { bg: '#92400E', pastel: '#FEF3C7', text: '#FFFFFF' }, // 7.09:1
  rose:   { bg: '#9D174D', pastel: '#FCE7F3', text: '#FFFFFF' }, // 7.88:1
  red:    { bg: '#B91C1C', pastel: '#FEE2E2', text: '#FFFFFF' }, // 6.47:1 — STATUS apenas para tags
  slate:  { bg: '#475569', pastel: '#E2E8F0', text: '#FFFFFF' }, // 7.58:1 — STATUS apenas para tags
};

const tagColorTokenNameSet = new Set<string>(TAG_COLOR_TOKEN_NAMES);

/** Valida enums persistidos que referenciam a paleta canonica de nove cores. */
export function isTagColorToken(value: string): value is TagColorToken {
  return tagColorTokenNameSet.has(value);
}

/**
 * Mapeamento palavra-chave → token.
 * Chaves em lowercase sem acento para comparação normalizada.
 * Se uma tag não estiver aqui, usar resolveTagColor() que retorna 'slate'
 * como fallback neutro.
 */
export const KEYWORD_TO_TOKEN: Record<string, TagColorToken> = {
  // Violet — tema principal
  'machine learning':  'violet',
  'consciousness':     'violet',
  'philosophy':        'violet',
  'deep learning':     'violet',
  'urbanismo':         'violet',
  'cognition':         'violet',

  // Indigo — tema principal (systems/design)
  'systems':           'indigo',
  'infra':             'indigo',
  'design systems':    'indigo',
  'typography':        'indigo',
  'accessibility':     'indigo',

  // Blue — subcategoria (linguagem)
  'nlp':               'blue',
  'transformers':      'blue',
  'language':          'blue',

  // Teal — subcategoria (percepção/visão)
  'computer vision':   'teal',
  'neuroscience':      'teal',
  'perception':        'teal',

  // Rose — subcategoria (teórica/humanas)
  'theory':            'rose',
  'math':              'rose',
  'epistemologia':     'rose',
  'memory':            'rose',
  'sociologia':        'rose',
  'reinforcement learning': 'rose',

  // Amber — destaque
  'ai safety':         'amber',
  'ethics':            'amber',
  'seminal':           'amber',

  // Status — não usar para assunto
  'concluído':         'green',
  'não iniciado':      'slate',
  'review':            'slate',
  // 'erro' e 'exclusão' são tratados pelo sistema, não pelo usuário
};

/**
 * Resolve o token de cor para uma palavra-chave de tag.
 * Normaliza para lowercase antes de buscar.
 * Retorna 'slate' se a palavra-chave não estiver mapeada.
 */
export function resolveTagColor(keyword: string): TagColorToken {
  const normalized = keyword.toLowerCase().trim();
  return KEYWORD_TO_TOKEN[normalized] ?? 'slate';
}

/**
 * Retorna o par bg/texto para uma palavra-chave de tag.
 * Atalho para resolveTagColor() + TAG_COLOR_TOKENS[].
 */
export function getTagColorPair(keyword: string): TagColorPair {
  return TAG_COLOR_TOKENS[resolveTagColor(keyword)];
}
