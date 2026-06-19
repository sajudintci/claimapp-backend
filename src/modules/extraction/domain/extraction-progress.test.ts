import { describe, expect, it } from "vitest";
import { resolveExtractionProgress } from "@/modules/extraction/domain/extraction-progress";

describe("resolveExtractionProgress", () => {
  it("maps queued job to step 1 of 5", () => {
    expect(resolveExtractionProgress({ jobStatus: "QUEUED", progressStage: "queued" })).toEqual({
      current: 1,
      total: 5,
      stage: "queued",
      label: "In queue",
    });
  });

  it("maps processing OCR stage to step 2", () => {
    expect(resolveExtractionProgress({ jobStatus: "PROCESSING", progressStage: "ocr" })).toEqual({
      current: 2,
      total: 5,
      stage: "ocr",
      label: "OCR extraction",
    });
  });

  it("maps processing LLM stage to step 3", () => {
    expect(resolveExtractionProgress({ jobStatus: "PROCESSING", progressStage: "llm" })).toMatchObject({
      current: 3,
      total: 5,
      stage: "llm",
    });
  });

  it("maps completed job to 5 of 5", () => {
    expect(resolveExtractionProgress({ jobStatus: "COMPLETED", progressStage: "completed" })).toEqual({
      current: 5,
      total: 5,
      stage: "completed",
      label: "Complete",
    });
  });

  it("defaults processing without stage to OCR step", () => {
    expect(resolveExtractionProgress({ jobStatus: "PROCESSING", progressStage: null }).current).toBe(2);
  });
});
