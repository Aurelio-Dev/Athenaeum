import { describe, expect, it } from "vitest";

import {
  estimateNotebookExportSizeBytes,
  isNotebookExportSizeAboveThreshold,
  notebookExportSizeWarningThresholdBytes,
  shouldGateNotebookExportSize,
} from "./notebookExportSizeEstimate";

describe("estimateNotebookExportSizeBytes", () => {
  it("returns just the HTML size for a notebook with no assets", () => {
    expect(estimateNotebookExportSizeBytes({ htmlByteLength: 42_000, resourceBytes: 0 })).toBe(42_000);
  });

  it("adds the base64 inflation (~4/3) of the raw resource bytes", () => {
    // 3.000 bytes crus -> 4.000 caracteres base64 (bloco exato).
    expect(estimateNotebookExportSizeBytes({ htmlByteLength: 1_000, resourceBytes: 3_000 })).toBe(1_000 + 4_000);
  });

  it("rounds the final base64 block up (padding)", () => {
    // 1 byte cru -> 4 caracteres base64 (um bloco com padding "==").
    expect(estimateNotebookExportSizeBytes({ htmlByteLength: 0, resourceBytes: 1 })).toBe(4);
    // 4 bytes -> ceil(4/3)=2 blocos -> 8 caracteres.
    expect(estimateNotebookExportSizeBytes({ htmlByteLength: 0, resourceBytes: 4 })).toBe(8);
  });

  it("treats negative or missing inputs as zero", () => {
    expect(estimateNotebookExportSizeBytes({ htmlByteLength: -10, resourceBytes: -5 })).toBe(0);
  });
});

describe("isNotebookExportSizeAboveThreshold", () => {
  it("is false right at the 100 MiB threshold", () => {
    expect(isNotebookExportSizeAboveThreshold(notebookExportSizeWarningThresholdBytes)).toBe(false);
  });

  it("is false just below the threshold", () => {
    expect(isNotebookExportSizeAboveThreshold(notebookExportSizeWarningThresholdBytes - 1)).toBe(false);
  });

  it("is true just above the threshold", () => {
    expect(isNotebookExportSizeAboveThreshold(notebookExportSizeWarningThresholdBytes + 1)).toBe(true);
  });

  it("flags an estimate built from large resources", () => {
    // ~80 MiB de recursos crus viram ~106 MiB em base64, acima do limiar.
    const estimate = estimateNotebookExportSizeBytes({
      htmlByteLength: 500_000,
      resourceBytes: 80 * 1024 * 1024,
    });

    expect(estimate).toBeGreaterThan(notebookExportSizeWarningThresholdBytes);
    expect(isNotebookExportSizeAboveThreshold(estimate)).toBe(true);
  });

  it("keeps a small export below the threshold", () => {
    const estimate = estimateNotebookExportSizeBytes({
      htmlByteLength: 700_000,
      resourceBytes: 5 * 1024 * 1024,
    });

    expect(isNotebookExportSizeAboveThreshold(estimate)).toBe(false);
  });
});

describe("shouldGateNotebookExportSize", () => {
  it("activates the gate when the estimate is unknown (null) — fail-safe", () => {
    expect(shouldGateNotebookExportSize(null)).toBe(true);
  });

  it("activates the gate above the threshold", () => {
    expect(shouldGateNotebookExportSize(notebookExportSizeWarningThresholdBytes + 1)).toBe(true);
  });

  it("does not gate right at the threshold", () => {
    expect(shouldGateNotebookExportSize(notebookExportSizeWarningThresholdBytes)).toBe(false);
  });

  it("does not gate a small known estimate", () => {
    expect(shouldGateNotebookExportSize(2 * 1024 * 1024)).toBe(false);
  });
});
