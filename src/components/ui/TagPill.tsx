import { getSubjectTagTone, toneClassNames } from "../../styles/designTokens";

type TagPillProps = {
  label: string;
};

export function TagPill({ label }: TagPillProps) {
  const tone = getSubjectTagTone(label);

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClassNames[tone].badge}`}>
      {label}
    </span>
  );
}
