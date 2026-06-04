import { Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { PermissionModel } from "./permission.model";
import { RoleModel } from "./role.model";

@Table({ tableName: "role_permissions" })
export class RolePermissionModel extends BaseModel<RolePermissionModel> {
  @ForeignKey(() => RoleModel)
  @Column(DataType.UUID)
  declare roleId: string;

  @ForeignKey(() => PermissionModel)
  @Column(DataType.UUID)
  declare permissionId: string;
}
