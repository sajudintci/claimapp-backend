import { Column, DataType, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";

@Table({ tableName: "permissions" })
export class PermissionModel extends BaseModel<PermissionModel> {
  @Column(DataType.STRING)
  declare key: string;
}
