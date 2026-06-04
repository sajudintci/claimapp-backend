import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { ClaimModel } from "./claim.model";

@Table({ tableName: "claim_documents" })
export class ClaimDocumentModel extends BaseModel<ClaimDocumentModel> {
  @ForeignKey(() => ClaimModel)
  @Column(DataType.UUID)
  declare claimId: string;

  @Column(DataType.STRING)
  declare originalName: string;

  @Column(DataType.STRING)
  declare mimeType: string;

  @Column(DataType.STRING)
  declare storagePath: string;

  @BelongsTo(() => ClaimModel)
  declare claim: ClaimModel;
}
