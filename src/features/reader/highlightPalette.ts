import type { HighlightColor } from "../../types/annotation";

type HighlightPaletteEntry = {
  label: string;
  bg: string;
  text: string;
  fillClassName: string;
  textClassName: string;
};

export const highlightPalette: Record<HighlightColor, HighlightPaletteEntry> = {
  amber: {
    label: "Amber",
    bg: "#92400E",
    text: "#FFFFFF",
    fillClassName: "bg-[#92400E]",
    textClassName: "text-[#92400E]",
  },
  violet: {
    label: "Violet",
    bg: "#5B21B6",
    text: "#FFFFFF",
    fillClassName: "bg-[#5B21B6]",
    textClassName: "text-[#5B21B6]",
  },
  indigo: {
    label: "Indigo",
    bg: "#4338CA",
    text: "#FFFFFF",
    fillClassName: "bg-[#4338CA]",
    textClassName: "text-[#4338CA]",
  },
  blue: {
    label: "Blue",
    bg: "#1D4ED8",
    text: "#FFFFFF",
    fillClassName: "bg-[#1D4ED8]",
    textClassName: "text-[#1D4ED8]",
  },
  teal: {
    label: "Teal",
    bg: "#0D5C54",
    text: "#FFFFFF",
    fillClassName: "bg-[#0D5C54]",
    textClassName: "text-[#0D5C54]",
  },
  rose: {
    label: "Rose",
    bg: "#9D174D",
    text: "#FFFFFF",
    fillClassName: "bg-[#9D174D]",
    textClassName: "text-[#9D174D]",
  },
};
