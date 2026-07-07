import { getSubjectTagTone, toneClassNames } from "../styles/designTokens";
import type { SubjectTag } from "../types/library";

type TagBadgeProps = {
  tag: SubjectTag;
  size?: "default" | "compact";
};

export function TagBadge({ tag, size = "default" }: TagBadgeProps) {
  const tone = getSubjectTagTone(tag);
  const sizeClassName = size === "compact" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  return (
    <span className={`inline-flex max-w-full items-center rounded-full font-semibold ${sizeClassName} ${toneClassNames[tone].badge}`}>
      <span className="truncate">{tag}</span>
    </span>
  );
}
