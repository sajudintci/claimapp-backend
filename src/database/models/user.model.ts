import {
  BelongsTo,
  BelongsToMany,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Table
} from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { OrganizationModel } from "./organization.model";
import { DepartmentModel } from "./department.model";
import { RoleModel } from "./role.model";
import { UserRoleModel } from "./user-role.model";
import { RefreshTokenModel } from "./refresh-token.model";

@Table({ tableName: "users" })
export class UserModel extends BaseModel<UserModel> {
  @ForeignKey(() => OrganizationModel)
  @Column(DataType.UUID)
  declare organizationId: string;

  @ForeignKey(() => DepartmentModel)
  @Column(DataType.UUID)
  declare departmentId: string;

  @Column(DataType.STRING)
  declare name: string;

  @Column(DataType.STRING)
  declare email: string;

  @Column(DataType.STRING)
  declare passwordHash: string;

  @Column(DataType.BOOLEAN)
  declare isActive: boolean;

  @Column({ type: DataType.STRING, allowNull: true })
  declare avatarFileName: string | null;

  @BelongsTo(() => OrganizationModel)
  declare organization: OrganizationModel;

  @BelongsTo(() => DepartmentModel)
  declare department: DepartmentModel;

  @BelongsToMany(() => RoleModel, () => UserRoleModel)
  declare roles: RoleModel[];

  @HasMany(() => RefreshTokenModel)
  declare refreshTokens: RefreshTokenModel[];
}
