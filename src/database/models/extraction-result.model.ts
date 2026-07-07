import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { ClaimModel } from "./claim.model";
import { ExtractionJobModel } from "./extraction-job.model";

@Table({ tableName: "extraction_results" })
export class ExtractionResultModel extends BaseModel<ExtractionResultModel> {
  @ForeignKey(() => ClaimModel)
  @Column(DataType.UUID)
  declare claimId: string;

  @ForeignKey(() => ExtractionJobModel)
  @Column({ type: DataType.UUID, allowNull: true })
  declare extractionJobId: string | null;

  @Column(DataType.JSONB)
  declare payload: Record<string, unknown>;

  @Column(DataType.STRING)
  declare source: string;

  @BelongsTo(() => ClaimModel)
  declare claim: ClaimModel;

  @BelongsTo(() => ExtractionJobModel)
  declare extractionJob: ExtractionJobModel;
}
