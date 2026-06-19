import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import { resolveExtractionProgress } from "@/modules/extraction/domain/extraction-progress";

export function mapExtractionJobDto(job: ExtractionJobModel) {
  const json = job.toJSON() as {
    id: string;
    claimId: string;
    status: string;
    attempts: number;
    errorMessage: string | null;
    progressStage?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  };

  return {
    id: json.id,
    claimId: json.claimId,
    status: json.status,
    attempts: json.attempts,
    errorMessage: json.errorMessage,
    progressStage: json.progressStage ?? null,
    progress: resolveExtractionProgress({
      jobStatus: json.status,
      progressStage: json.progressStage,
    }),
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
}
