import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { ClaimModel } from "./claim.model";

@Table({ tableName: "extraction_jobs" })
export class ExtractionJobModel extends BaseModel<ExtractionJobModel> {
  @ForeignKey(() => ClaimModel)
  @Column(DataType.UUID)
  declare claimId: string;

  @Column(DataType.STRING)
  declare status: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare progressStage: string | null;

  @Column(DataType.INTEGER)
  declare attempts: number;

  @Column(DataType.TEXT)
  declare errorMessage: string | null;

  @BelongsTo(() => ClaimModel)
  declare claim: ClaimModel;
}
