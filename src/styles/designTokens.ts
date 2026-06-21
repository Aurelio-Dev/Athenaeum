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

  if (subjectTagTone[tag]) {
    return subjectTagTone[tag];
  }

  const tones = Object.keys(toneClassNames) as Tone[];
  const tagCodeSum = [...tag].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return tones[tagCodeSum % tones.length];
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
