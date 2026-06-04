import { Transaction } from "sequelize";
import { sequelize } from "@/database/sequelize";
import { OrganizationModel } from "@/database/models/organization.model";
import { OcrCreditTransactionModel } from "@/database/models/ocr-credit-transaction.model";
import { env } from "@/config/env";
import { createId } from "@/utils/id";
import { logger } from "@/infrastructure/logger/winston";

export class InsufficientOcrCreditsError extends Error {
  readonly code = "INSUFFICIENT_OCR_CREDITS";

  constructor(
    public readonly required: number,
    public readonly remaining: number,
  ) {
    super(`Insufficient OCR credits: need ${required}, have ${remaining}`);
    this.name = "InsufficientOcrCreditsError";
  }
}

/** 1 page = 1 OCR credit; unknown page count counts as 1 page. */
export function creditsFromPageCount(pageCount?: number | null): number {
  if (typeof pageCount === "number" && pageCount > 0) {
    return Math.floor(pageCount);
  }
  return 1;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function rollMonthlyUsageIfNeeded(
  org: OrganizationModel,
  transaction: Transaction,
): Promise<OrganizationModel> {
  const period = currentPeriod();
  if (org.ocrCreditsPeriod === period) return org;

  await org.update(
    {
      ocrCreditsPeriod: period,
      ocrCreditsUsedThisMonth: 0,
    },
    { transaction },
  );
  return org.reload({ transaction });
}

export type OcrCreditUsageSnapshot = {
  remainingCredits: number;
  usedThisMonth: number;
  monthlyQuota: number;
  expiryDate: string;
};

export async function getOcrCreditUsage(
  organizationId: string,
): Promise<OcrCreditUsageSnapshot> {
  return sequelize.transaction(async (transaction) => {
    const org = await OrganizationModel.findByPk(organizationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!org) {
      throw new Error("ORG_NOT_FOUND");
    }

    const refreshed = await rollMonthlyUsageIfNeeded(org, transaction);
    const period = refreshed.ocrCreditsPeriod ?? currentPeriod();
    const [year, month] = period.split("-").map(Number);
    const expiry = new Date(Date.UTC(year, month, 0));

    return {
      remainingCredits: refreshed.ocrCreditsRemaining,
      usedThisMonth: refreshed.ocrCreditsUsedThisMonth,
      monthlyQuota: refreshed.ocrMonthlyQuota,
      expiryDate: expiry.toISOString().slice(0, 10),
    };
  });
}

export async function assertSufficientOcrCredits(
  organizationId: string,
  requiredCredits: number,
): Promise<void> {
  const required = Math.max(1, Math.floor(requiredCredits));
  const usage = await getOcrCreditUsage(organizationId);
  if (usage.remainingCredits < required) {
    throw new InsufficientOcrCreditsError(required, usage.remainingCredits);
  }
}

/**
 * Debit OCR credits after a successful extraction (idempotent per extraction job).
 */
export async function deductOcrCreditsForSuccessfulExtraction(params: {
  organizationId: string;
  claimId: string;
  extractionJobId: string;
  pageCount?: number | null;
}): Promise<{ credits: number; remaining: number }> {
  const credits = creditsFromPageCount(params.pageCount);

  return sequelize.transaction(async (transaction) => {
    const existing = await OcrCreditTransactionModel.findOne({
      where: {
        extractionJobId: params.extractionJobId,
        type: "debit",
      },
      transaction,
    });
    if (existing) {
      return { credits: existing.credits, remaining: existing.balanceAfter };
    }

    const org = await OrganizationModel.findByPk(params.organizationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!org) {
      throw new Error("ORG_NOT_FOUND");
    }

    await rollMonthlyUsageIfNeeded(org, transaction);

    if (org.ocrCreditsRemaining < credits) {
      throw new InsufficientOcrCreditsError(credits, org.ocrCreditsRemaining);
    }

    const remaining = org.ocrCreditsRemaining - credits;
    const usedThisMonth = org.ocrCreditsUsedThisMonth + credits;

    await org.update(
      {
        ocrCreditsRemaining: remaining,
        ocrCreditsUsedThisMonth: usedThisMonth,
      },
      { transaction },
    );

    await OcrCreditTransactionModel.create(
      {
        id: createId(),
        organizationId: params.organizationId,
        claimId: params.claimId,
        extractionJobId: params.extractionJobId,
        type: "debit",
        pageCount: credits,
        credits,
        balanceAfter: remaining,
        note: "extraction_success",
      } as any,
      { transaction },
    );

    logger.info("OCR credits deducted", {
      organizationId: params.organizationId,
      claimId: params.claimId,
      extractionJobId: params.extractionJobId,
      pageCount: params.pageCount ?? null,
      credits,
      remaining,
    });

    return { credits, remaining };
  });
}

export async function ensureOrganizationOcrCredits(
  organizationId: string,
): Promise<void> {
  const org = await OrganizationModel.findByPk(organizationId);
  if (!org) return;

  const quota = env.OCR_CREDITS_MONTHLY_QUOTA;
  const hasBalance =
    Number.isFinite(org.ocrCreditsRemaining) && org.ocrCreditsRemaining > 0;
  const hasQuota = Number.isFinite(org.ocrMonthlyQuota) && org.ocrMonthlyQuota > 0;

  if (hasBalance && hasQuota && org.ocrCreditsPeriod) return;

  await org.update({
    ocrCreditsRemaining: hasBalance ? org.ocrCreditsRemaining : quota,
    ocrMonthlyQuota: hasQuota ? org.ocrMonthlyQuota : quota,
    ocrCreditsUsedThisMonth: Number.isFinite(org.ocrCreditsUsedThisMonth)
      ? org.ocrCreditsUsedThisMonth
      : 0,
    ocrCreditsPeriod: org.ocrCreditsPeriod ?? currentPeriod(),
  });
}

export async function backfillOrganizationOcrCredits(): Promise<void> {
  const orgs = await OrganizationModel.findAll({ attributes: ["id"] });
  for (const org of orgs) {
    await ensureOrganizationOcrCredits(org.id);
  }
}
