export type ReaderPageLayout = "single" | "spread";

export type ReaderZoomMode = "custom" | "actual" | "page" | "width" | "height" | "visible";

export type ReaderViewPreferences = {
  pageLayout: ReaderPageLayout;
  continuousScroll: boolean;
  showCover: boolean;
};

export type NormalizedContentBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  confidence: "high" | "medium" | "low";
};

export type ReaderFitPage = {
  width: number;
  height: number;
  bounds?: NormalizedContentBounds;
};

export const defaultReaderViewPreferences: ReaderViewPreferences = {
  pageLayout: "single",
  continuousScroll: true,
  showCover: false,
};

export const fullPageContentBounds: NormalizedContentBounds = {
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
  confidence: "low",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseReaderViewPreferences(value: string | null): ReaderViewPreferences {
  if (!value) {
    return defaultReaderViewPreferences;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return defaultReaderViewPreferences;
    }

    return {
      pageLayout: parsed.pageLayout === "spread" ? "spread" : "single",
      continuousScroll: typeof parsed.continuousScroll === "boolean" ? parsed.continuousScroll : true,
      showCover: typeof parsed.showCover === "boolean" ? parsed.showCover : false,
    };
  } catch {
    return defaultReaderViewPreferences;
  }
}

export function groupReaderPages(totalPages: number, layout: ReaderPageLayout, showCover: boolean): number[][] {
  const safeTotal = Math.max(0, Math.floor(totalPages));
  if (safeTotal === 0) {
    return [];
  }

  if (layout === "single") {
    return Array.from({ length: safeTotal }, (_, index) => [index + 1]);
  }

  const groups: number[][] = [];
  let page = 1;

  if (showCover) {
    groups.push([1]);
    page = 2;
  }

  while (page <= safeTotal) {
    groups.push(page + 1 <= safeTotal ? [page, page + 1] : [page]);
    page += 2;
  }

  return groups;
}

export function getReaderPageGroup(groups: readonly number[][], page: number): number[] {
  return groups.find((group) => group.includes(page)) ?? groups[0] ?? [];
}

export function getReaderProgressPage(group: readonly number[], currentPage: number) {
  return group[group.length - 1] ?? currentPage;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getSafeBounds(bounds: NormalizedContentBounds | undefined) {
  if (!bounds) {
    return fullPageContentBounds;
  }

  const left = clamp(bounds.left, 0, 1);
  const top = clamp(bounds.top, 0, 1);
  const right = clamp(bounds.right, left, 1);
  const bottom = clamp(bounds.bottom, top, 1);

  if (right - left <= 0 || bottom - top <= 0) {
    return fullPageContentBounds;
  }

  return { ...bounds, left, top, right, bottom };
}

export function calculateReaderFitZoom({
  pages,
  availableWidth,
  availableHeight,
  mode,
  pageGap,
  minZoom,
  maxZoom,
  safetyRatio = 0.98,
}: {
  pages: readonly ReaderFitPage[];
  availableWidth: number;
  availableHeight: number;
  mode: Exclude<ReaderZoomMode, "custom">;
  pageGap: number;
  minZoom: number;
  maxZoom: number;
  safetyRatio?: number;
}) {
  if (mode === "actual") {
    return clamp(100, minZoom, maxZoom);
  }

  const safePages = pages.filter(
    (page) => Number.isFinite(page.width) && page.width > 0 && Number.isFinite(page.height) && page.height > 0,
  );
  if (safePages.length === 0) {
    return clamp(100, minZoom, maxZoom);
  }
  if (availableWidth <= 0 || availableHeight <= 0) {
    return minZoom;
  }

  const fixedGap = Math.max(0, pageGap) * Math.max(0, safePages.length - 1);
  let widthAtHundred = safePages.reduce((total, page) => total + page.width, 0);
  let heightAtHundred = Math.max(...safePages.map((page) => page.height));

  if (mode === "visible") {
    const firstPage = safePages[0];
    const lastPage = safePages[safePages.length - 1];
    const firstBounds = getSafeBounds(firstPage.bounds);
    const lastBounds = getSafeBounds(lastPage.bounds);

    if (safePages.length === 1) {
      widthAtHundred = firstPage.width * (firstBounds.right - firstBounds.left);
    } else {
      const middleWidth = safePages
        .slice(1, -1)
        .reduce((total, page) => total + page.width, 0);
      widthAtHundred =
        firstPage.width * (1 - firstBounds.left) +
        middleWidth +
        lastPage.width * lastBounds.right;
    }

    const contentTop = Math.min(
      ...safePages.map((page) => page.height * getSafeBounds(page.bounds).top),
    );
    const contentBottom = Math.max(
      ...safePages.map((page) => page.height * getSafeBounds(page.bounds).bottom),
    );
    heightAtHundred = contentBottom - contentTop;
  }

  if (widthAtHundred <= 0 || heightAtHundred <= 0) {
    return clamp(100, minZoom, maxZoom);
  }

  const usableWidth = Math.max(1, availableWidth - fixedGap);
  const widthZoom = (usableWidth / widthAtHundred) * 100 * safetyRatio;
  const heightZoom = (availableHeight / heightAtHundred) * 100 * safetyRatio;
  const target = mode === "width" ? widthZoom : mode === "height" ? heightZoom : Math.min(widthZoom, heightZoom);

  return clamp(Math.floor(target), minZoom, maxZoom);
}
