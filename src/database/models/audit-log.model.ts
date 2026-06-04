import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { OrganizationModel } from "./organization.model";
import { UserModel } from "./user.model";

@Table({ tableName: "audit_logs" })
export class AuditLogModel extends BaseModel<AuditLogModel> {
  @ForeignKey(() => OrganizationModel)
  @Column(DataType.UUID)
  declare organizationId: string;

  @ForeignKey(() => UserModel)
  @Column(DataType.UUID)
  declare userId: string;

  @Column(DataType.STRING)
  declare action: string;

  @Column(DataType.STRING)
  declare entityType: string;

  @Column(DataType.STRING)
  declare entityId: string;

  @Column(DataType.JSONB)
  declare beforeChanges: Record<string, unknown> | null;

  @Column(DataType.JSONB)
  declare afterChanges: Record<string, unknown> | null;

  @Column(DataType.STRING)
  declare ipAddress: string;

  @BelongsTo(() => UserModel)
  declare user: UserModel;
}
