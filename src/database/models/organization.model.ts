import { Column, DataType, HasMany, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";
import { UserModel } from "./user.model";

@Table({ tableName: "organizations" })
export class OrganizationModel extends BaseModel<OrganizationModel> {
  @Column(DataType.STRING)
  declare name: string;

  @Column(DataType.STRING)
  declare code: string;

  /** Remaining OCR credits (1 credit = 1 page). */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 16000 })
  declare ocrCreditsRemaining: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 16000 })
  declare ocrMonthlyQuota: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare ocrCreditsUsedThisMonth: number;

  /** YYYY-MM — resets `ocrCreditsUsedThisMonth` when the calendar month changes. */
  @Column({ type: DataType.STRING, allowNull: true })
  declare ocrCreditsPeriod: string | null;

  @HasMany(() => UserModel)
  declare users: UserModel[];
}
