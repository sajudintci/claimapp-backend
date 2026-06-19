export const OutboxEventType = {
  EXTRACTION_REQUESTED: "EXTRACTION_REQUESTED",
} as const;

export type OutboxEventTypeValue = (typeof OutboxEventType)[keyof typeof OutboxEventType];

export type ExtractionRequestedPayload = {
  claimId: string;
  extractionJobId: string;
};

export type OutboxPayload = ExtractionRequestedPayload;
