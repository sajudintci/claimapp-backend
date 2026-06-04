import { BelongsToMany, Column, DataType, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { PermissionModel } from "./permission.model";
import { RolePermissionModel } from "./role-permission.model";

@Table({ tableName: "roles" })
export class RoleModel extends BaseModel<RoleModel> {
  @Column(DataType.STRING)
  declare name: string;

  @BelongsToMany(() => PermissionModel, () => RolePermissionModel)
  declare permissions: PermissionModel[];
}
