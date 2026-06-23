import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { ClaimModel } from "./claim.model";
import { ExtractionJobModel } from "./extraction-job.model";

@Table({ tableName: "ocr_preprocess_histories" })
export class OcrPreprocessHistoryModel extends BaseModel<OcrPreprocessHistoryModel> {
  @ForeignKey(() => ClaimModel)
  @Column(DataType.UUID)
  declare claimId: string;

  @ForeignKey(() => ExtractionJobModel)
  @Column(DataType.UUID)
  declare extractionJobId: string;

  @Column(DataType.STRING)
  declare source: string;

  @Column(DataType.JSONB)
  declare payload: Record<string, unknown>;

  @BelongsTo(() => ClaimModel)
  declare claim: ClaimModel;

  @BelongsTo(() => ExtractionJobModel)
  declare extractionJob: ExtractionJobModel;
}
