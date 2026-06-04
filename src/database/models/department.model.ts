import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { OrganizationModel } from "./organization.model";

@Table({ tableName: "departments" })
export class DepartmentModel extends BaseModel<DepartmentModel> {
  @ForeignKey(() => OrganizationModel)
  @Column(DataType.UUID)
  declare organizationId: string;

  @Column(DataType.STRING)
  declare name: string;

  @BelongsTo(() => OrganizationModel)
  declare organization: OrganizationModel;
}
