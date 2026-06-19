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

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true })
  declare reviewerId: string | null;

  @Column(DataType.STRING)
  declare claimNumber: string;

  @Column(DataType.STRING)
  declare status: string;

  @Column(DataType.JSONB)
  declare extractionResult: Record<string, unknown> | null;

  @Column(DataType.JSONB)
  declare reviewedResult: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare metadata: Record<string, unknown> | null;

  @BelongsTo(() => OrganizationModel)
  declare organization: OrganizationModel;

  @BelongsTo(() => UserModel, { foreignKey: "reviewerId", as: "reviewer" })
  declare reviewer: UserModel;

  @HasMany(() => ClaimDocumentModel)
  declare documents: ClaimDocumentModel[];
}
