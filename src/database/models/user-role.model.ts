import { Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { RoleModel } from "./role.model";
import { UserModel } from "./user.model";

@Table({ tableName: "user_roles" })
export class UserRoleModel extends BaseModel<UserRoleModel> {
  @ForeignKey(() => UserModel)
  @Column(DataType.UUID)
  declare userId: string;

  @ForeignKey(() => RoleModel)
  @Column(DataType.UUID)
  declare roleId: string;
}
