import { Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { OrganizationModel } from "./organization.model";

@Table({ tableName: "notifications" })
export class NotificationModel extends BaseModel<NotificationModel> {
  @ForeignKey(() => OrganizationModel)
  @Column(DataType.UUID)
  declare organizationId: string;

  @Column(DataType.STRING)
  declare type: string;

  @Column(DataType.STRING)
  declare title: string;

  @Column(DataType.TEXT)
  declare message: string;

  @Column(DataType.BOOLEAN)
  declare isRead: boolean;
}
