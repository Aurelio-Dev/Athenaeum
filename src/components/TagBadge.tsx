import { getSubjectTagTone, toneClassNames } from "../styles/designTokens";
import type { SubjectTag } from "../types/library";

type TagBadgeProps = {
  tag: SubjectTag;
};

export function TagBadge({ tag }: TagBadgeProps) {
  const tone = getSubjectTagTone(tag);

  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ${toneClassNames[tone].badge}`}>
      <span className="truncate">{tag}</span>
    </span>
  );
}
