import { getTagColorPair } from "../../lib/tagColors";

type TagPillProps = {
  label: string;
};

// Pilula de tag em fill solido (padrao de producao). O par bg/texto vem em
// runtime de getTagColorPair() e cada palavra-chave usa sempre o mesmo par em
// todas as telas, por isso o estilo de cor e inline (nao Tailwind arbitrario).
export function TagPill({ label }: TagPillProps) {
  const { bg, text } = getTagColorPair(label);

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      {label}
    </span>
  );
}
