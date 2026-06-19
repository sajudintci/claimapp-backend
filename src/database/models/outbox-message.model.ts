import { Column, DataType, Table } from "sequelize-typescript";
import { BaseModel } from "./base.model";

export const OutboxMessageStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
} as const;

export type OutboxMessageStatusValue =
  (typeof OutboxMessageStatus)[keyof typeof OutboxMessageStatus];

@Table({ tableName: "outbox_messages" })
export class OutboxMessageModel extends BaseModel<OutboxMessageModel> {
  @Column(DataType.STRING)
  declare eventType: string;

  @Column(DataType.STRING)
  declare aggregateType: string;

  @Column(DataType.UUID)
  declare aggregateId: string;

  @Column(DataType.JSONB)
  declare payload: Record<string, unknown>;

  @Column(DataType.STRING)
  declare status: OutboxMessageStatusValue;

  @Column(DataType.INTEGER)
  declare publishAttempts: number;

  @Column(DataType.TEXT)
  declare lastError: string | null;

  @Column(DataType.DATE)
  declare publishedAt: Date | null;
}
