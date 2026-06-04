import { BelongsTo, Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { UserModel } from "./user.model";

@Table({ tableName: "refresh_tokens" })
export class RefreshTokenModel extends BaseModel<RefreshTokenModel> {
  @ForeignKey(() => UserModel)
  @Column(DataType.UUID)
  declare userId: string;

  @Column(DataType.TEXT)
  declare token: string;

  @Column(DataType.DATE)
  declare expiresAt: Date;

  @BelongsTo(() => UserModel)
  declare user: UserModel;
}
