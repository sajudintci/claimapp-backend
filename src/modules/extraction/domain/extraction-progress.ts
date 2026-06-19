export const EXTRACTION_PROGRESS_STAGES = [
  { id: "queued", label: "In queue" },
  { id: "ocr", label: "OCR extraction" },
  { id: "llm", label: "LLM structuring" },
  { id: "validate", label: "Validation & synthesis" },
  { id: "persist", label: "Saving results" },
] as const;

export type ExtractionProgressStageId =
  | (typeof EXTRACTION_PROGRESS_STAGES)[number]["id"]
  | "completed"
  | "failed";

export type ExtractionProgressView = {
  current: number;
  total: number;
  stage: ExtractionProgressStageId;
  label: string;
};

const STAGE_INDEX = new Map(
  EXTRACTION_PROGRESS_STAGES.map((stage, index) => [stage.id, index]),
);

function isKnownPipelineStage(
  value: string,
): value is (typeof EXTRACTION_PROGRESS_STAGES)[number]["id"] {
  return EXTRACTION_PROGRESS_STAGES.some((stage) => stage.id === value);
}

function normalizePipelineStage(
  progressStage?: string | null,
): (typeof EXTRACTION_PROGRESS_STAGES)[number]["id"] | null {
  if (!progressStage) return null;
  if (progressStage === "completed" || progressStage === "failed") return null;
  return isKnownPipelineStage(progressStage) ? progressStage : null;
}

export function resolveExtractionProgress(input: {
  jobStatus: string;
  progressStage?: string | null;
}): ExtractionProgressView {
  const total = EXTRACTION_PROGRESS_STAGES.length;
  const status = input.jobStatus.toUpperCase();

  if (status === "COMPLETED") {
    return {
      current: total,
      total,
      stage: "completed",
      label: "Complete",
    };
  }

  if (status === "FAILED") {
    const pipelineStage = normalizePipelineStage(input.progressStage);
    const current = pipelineStage != null ? STAGE_INDEX.get(pipelineStage)! + 1 : 1;
    return {
      current,
      total,
      stage: "failed",
      label: "Failed",
    };
  }

  if (status === "QUEUED") {
    return {
      current: 1,
      total,
      stage: "queued",
      label: EXTRACTION_PROGRESS_STAGES[0].label,
    };
  }

  const pipelineStage = normalizePipelineStage(input.progressStage) ?? "ocr";
  const index = STAGE_INDEX.get(pipelineStage) ?? 1;

  return {
    current: index + 1,
    total,
    stage: pipelineStage,
    label: EXTRACTION_PROGRESS_STAGES[index]?.label ?? "Processing",
  };
}
