import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { OrganizationModel } from "./organization.model";
import { UserModel } from "./user.model";
import { ClaimDocumentModel } from "./claim-document.model";

@Table({ tableName: "claims" })
export class ClaimModel extends BaseModel<ClaimModel> {
  @ForeignKey(() => OrganizationModel)
  @Column(DataType.UUID)
  declare organizationId: string;

  @ForeignKey(() => UserModel)
  @Column(DataType.UUID)
  declare createdBy: string;

  @Column(DataType.STRING)
  declare claimNumber: string;

  @Column(DataType.STRING)
  declare status: string;

  @Column(DataType.JSONB)
  declare extractionResult: Record<string, unknown> | null;

  @Column(DataType.JSONB)
  declare reviewedResult: Record<string, unknown> | null;

  @BelongsTo(() => OrganizationModel)
  declare organization: OrganizationModel;

  @HasMany(() => ClaimDocumentModel)
  declare documents: ClaimDocumentModel[];
}
