import { ClaimModel } from "@/database/models/claim.model";
import { UserModel } from "@/database/models/user.model";

type ClaimDocumentJson = {
  originalName?: string;
};

export type ClaimListItemDto = {
  id: string;
  claimNumber: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  extractionResult: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  primaryDocument: { id?: string; originalName?: string } | null;
  reviewer: { id: string; name: string } | null;
};

export function mapClaimListItem(row: ClaimModel): ClaimListItemDto {
  const json = row.toJSON() as unknown as Record<string, unknown> & {
    documents?: ClaimDocumentJson[];
    reviewer?: UserModel | null;
  };

  const primaryDocument = json.documents?.[0] ?? null;
  const reviewerUser = json.reviewer;

  return {
    id: String(json.id),
    claimNumber: String(json.claimNumber ?? ""),
    status: String(json.status ?? "Processing"),
    createdAt: new Date(String(json.createdAt)).toISOString(),
    updatedAt: new Date(String(json.updatedAt)).toISOString(),
    extractionResult: (json.extractionResult as Record<string, unknown> | null) ?? null,
    metadata: (json.metadata as Record<string, unknown> | null) ?? null,
    primaryDocument,
    reviewer:
      reviewerUser && typeof reviewerUser === "object" && reviewerUser.id
        ? { id: reviewerUser.id, name: reviewerUser.name }
        : null,
  };
}
