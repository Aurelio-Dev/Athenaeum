import type { DocumentStatus, SubjectTag, Tone } from "../types/library";

type ToneClassNames = {
  badge: string;
  spine: string;
};

type StatusToken = {
  label: string;
  className: string;
  dotClassName: string;
};

export const subjectTagTone: Record<string, Tone> = {
  "Machine Learning": "violet",
  "Systems / Infra": "indigo",
  NLP: "blue",
  "Computer Vision": "teal",
  "Theory / Math": "rose",
  "AI Safety / Ethics": "amber",
};

export const subjectTagTones: Tone[] = ["violet", "indigo", "blue", "teal", "rose", "amber"];

const registeredSubjectTagTones = new Map<string, Tone>();

function normalizeSubjectTag(tag: string) {
  return tag.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

const normalizedSubjectTagTone = Object.fromEntries(
  Object.entries(subjectTagTone).map(([tag, tone]) => [normalizeSubjectTag(tag), tone]),
) as Record<string, Tone>;

export const toneClassNames: Record<Tone, ToneClassNames> = {
  violet: {
    badge: "bg-tag-violet text-tag-violet-text",
    spine: "bg-spine-violet",
  },
  indigo: {
    badge: "bg-tag-indigo text-tag-indigo-text",
    spine: "bg-spine-indigo",
  },
  blue: {
    badge: "bg-tag-blue text-tag-blue-text",
    spine: "bg-spine-blue",
  },
  teal: {
    badge: "bg-tag-teal text-tag-teal-text",
    spine: "bg-spine-teal",
  },
  rose: {
    badge: "bg-tag-rose text-tag-rose-text",
    spine: "bg-spine-rose",
  },
  amber: {
    badge: "bg-tag-amber text-tag-amber-text",
    spine: "bg-spine-amber",
  },
};

export function getSubjectTagTone(tag?: SubjectTag | null) {
  if (!tag) {
    return "indigo";
  }

  const normalizedTag = normalizeSubjectTag(tag);
  const registeredTone = registeredSubjectTagTones.get(normalizedTag);

  if (registeredTone) {
    return registeredTone;
  }

  if (normalizedSubjectTagTone[normalizedTag]) {
    return normalizedSubjectTagTone[normalizedTag];
  }

  const matchingKnownTag = Object.entries(normalizedSubjectTagTone).find(([knownTag]) => normalizedTag.includes(knownTag) || knownTag.includes(normalizedTag));

  if (matchingKnownTag) {
    return matchingKnownTag[1];
  }

  const tagCodeSum = [...tag].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return subjectTagTones[tagCodeSum % subjectTagTones.length];
}

export function registerSubjectTagTone(tag: SubjectTag, tone: Tone) {
  registeredSubjectTagTones.set(normalizeSubjectTag(tag), tone);
}

export function rememberSubjectTagToneAlias(previousTag: SubjectTag, nextTag: SubjectTag) {
  registerSubjectTagTone(nextTag, getSubjectTagTone(previousTag));
}

export function getNextSubjectTagTone(tag: SubjectTag) {
  const currentTone = getSubjectTagTone(tag);
  const currentIndex = subjectTagTones.indexOf(currentTone);
  return subjectTagTones[(currentIndex + 1) % subjectTagTones.length];
}

export const statusTokens: Record<DocumentStatus, StatusToken> = {
  "in-progress": {
    label: "Em progresso",
    className: "bg-primary-soft text-primary-text",
    dotClassName: "bg-primary",
  },
  completed: {
    label: "Concluído",
    className: "bg-status-green text-status-green-text",
    dotClassName: "bg-status-green-text",
  },
  "not-started": {
    label: "Não iniciado",
    className: "bg-status-slate text-status-slate-text",
    dotClassName: "bg-status-slate-text",
  },
  error: {
    label: "Erro",
    className: "bg-status-red text-status-red-text",
    dotClassName: "bg-status-red-text",
  },
  trashed: {
    label: "Na lixeira",
    className: "bg-status-red text-status-red-text",
    dotClassName: "bg-status-red-text",
  },
};
