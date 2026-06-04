import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { ClaimModel } from "./claim.model";

@Table({ tableName: "extraction_results" })
export class ExtractionResultModel extends BaseModel<ExtractionResultModel> {
  @ForeignKey(() => ClaimModel)
  @Column(DataType.UUID)
  declare claimId: string;

  @Column(DataType.JSONB)
  declare payload: Record<string, unknown>;

  @Column(DataType.STRING)
  declare source: string;

  @BelongsTo(() => ClaimModel)
  declare claim: ClaimModel;
}
