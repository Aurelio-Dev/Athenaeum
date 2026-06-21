import { getSubjectTagTone, toneClassNames } from "../styles/designTokens";
import type { SubjectTag } from "../types/library";

type TagBadgeProps = {
  tag: SubjectTag;
};

export function TagBadge({ tag }: TagBadgeProps) {
  const tone = getSubjectTagTone(tag);

  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${toneClassNames[tone].badge}`}>
      {tag}
    </span>
  );
}
