/** Redis distributed lock keys (suffix only; prefix from env). */
export const DistributedLockKey = {
  OUTBOX_RELAY: "outbox-relay",
  OUTBOX_RECOVER: "outbox-recover",
} as const;
