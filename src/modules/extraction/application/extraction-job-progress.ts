import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import type { ExtractionProgressStageId } from "@/modules/extraction/domain/extraction-progress";

export async function updateExtractionJobProgress(
  extractionJobId: string,
  progressStage: ExtractionProgressStageId,
): Promise<void> {
  await ExtractionJobModel.update({ progressStage }, { where: { id: extractionJobId } });
}
