import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { OrganizationModel } from "./organization.model";
import { ClaimModel } from "./claim.model";
import { ExtractionJobModel } from "./extraction-job.model";

export type OcrCreditTransactionType = "debit" | "grant" | "adjustment";

@Table({ tableName: "ocr_credit_transactions" })
export class OcrCreditTransactionModel extends BaseModel<OcrCreditTransactionModel> {
  @ForeignKey(() => OrganizationModel)
  @Column(DataType.UUID)
  declare organizationId: string;

  @ForeignKey(() => ClaimModel)
  @Column({ type: DataType.UUID, allowNull: true })
  declare claimId: string | null;

  @ForeignKey(() => ExtractionJobModel)
  @Column({ type: DataType.UUID, allowNull: true })
  declare extractionJobId: string | null;

  @Column(DataType.STRING)
  declare type: OcrCreditTransactionType;

  @Column(DataType.INTEGER)
  declare pageCount: number;

  @Column(DataType.INTEGER)
  declare credits: number;

  @Column(DataType.INTEGER)
  declare balanceAfter: number;

  @Column(DataType.STRING)
  declare note: string | null;

  @BelongsTo(() => OrganizationModel)
  declare organization: OrganizationModel;
}
