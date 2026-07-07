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
 * Reserve OCR credits when queuing extraction (idempotent per extraction job).
 * Decrements remaining balance immediately; settled or released after job ends.
 */
export async function reserveOcrCredits(
  params: {
    organizationId: string;
    claimId: string;
    extractionJobId: string;
    credits?: number;
  },
  transaction: Transaction,
): Promise<void> {
  const credits = Math.max(1, Math.floor(params.credits ?? 1));

  const existing = await OcrCreditTransactionModel.findOne({
    where: {
      extractionJobId: params.extractionJobId,
      type: "hold",
    },
    transaction,
  });
  if (existing) return;

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
  await org.update({ ocrCreditsRemaining: remaining }, { transaction });

  await OcrCreditTransactionModel.create(
    {
      id: createId(),
      organizationId: params.organizationId,
      claimId: params.claimId,
      extractionJobId: params.extractionJobId,
      type: "hold",
      pageCount: credits,
      credits,
      balanceAfter: remaining,
      note: "extraction_reserved",
    } as any,
    { transaction },
  );

  logger.info("OCR credits reserved", {
    organizationId: params.organizationId,
    claimId: params.claimId,
    extractionJobId: params.extractionJobId,
    credits,
    remaining,
  });
}

/** Adjust a hold to the actual page count after OCR (may take or return credits). */
export async function adjustOcrCreditReservation(params: {
  organizationId: string;
  extractionJobId: string;
  pageCount?: number | null;
}): Promise<void> {
  const required = creditsFromPageCount(params.pageCount);

  await sequelize.transaction(async (transaction) => {
    const hold = await OcrCreditTransactionModel.findOne({
      where: {
        extractionJobId: params.extractionJobId,
        type: "hold",
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!hold) {
      throw new Error("OCR_HOLD_NOT_FOUND");
    }
    if (hold.credits === required) return;

    const org = await OrganizationModel.findByPk(params.organizationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!org) {
      throw new Error("ORG_NOT_FOUND");
    }

    const delta = required - hold.credits;
    if (delta > 0) {
      if (org.ocrCreditsRemaining < delta) {
        throw new InsufficientOcrCreditsError(required, org.ocrCreditsRemaining + hold.credits);
      }
      const remaining = org.ocrCreditsRemaining - delta;
      await org.update({ ocrCreditsRemaining: remaining }, { transaction });
      await hold.update(
        {
          credits: required,
          pageCount: required,
          balanceAfter: remaining,
        },
        { transaction },
      );
    } else {
      const refund = -delta;
      const remaining = org.ocrCreditsRemaining + refund;
      await org.update({ ocrCreditsRemaining: remaining }, { transaction });
      await hold.update(
        {
          credits: required,
          pageCount: required,
          balanceAfter: remaining,
        },
        { transaction },
      );
    }
  });
}

/**
 * Debit OCR credits after a successful extraction (idempotent per extraction job).
 * Converts an existing hold into a debit; falls back to direct debit when no hold exists.
 */
export async function deductOcrCreditsForSuccessfulExtraction(params: {
  organizationId: string;
  claimId: string;
  extractionJobId: string;
  pageCount?: number | null;
}): Promise<{ credits: number; remaining: number }> {
  const credits = creditsFromPageCount(params.pageCount);

  return sequelize.transaction(async (transaction) => {
    const existingDebit = await OcrCreditTransactionModel.findOne({
      where: {
        extractionJobId: params.extractionJobId,
        type: "debit",
      },
      transaction,
    });
    if (existingDebit) {
      return { credits: existingDebit.credits, remaining: existingDebit.balanceAfter };
    }

    const hold = await OcrCreditTransactionModel.findOne({
      where: {
        extractionJobId: params.extractionJobId,
        type: "hold",
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const org = await OrganizationModel.findByPk(params.organizationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!org) {
      throw new Error("ORG_NOT_FOUND");
    }

    await rollMonthlyUsageIfNeeded(org, transaction);

    if (hold) {
      if (hold.credits !== credits) {
        const delta = credits - hold.credits;
        if (delta > 0 && org.ocrCreditsRemaining < delta) {
          throw new InsufficientOcrCreditsError(credits, org.ocrCreditsRemaining + hold.credits);
        }
        if (delta !== 0) {
          const remaining = org.ocrCreditsRemaining - delta;
          await org.update({ ocrCreditsRemaining: remaining }, { transaction });
          await hold.update(
            { credits, pageCount: credits, balanceAfter: remaining },
            { transaction },
          );
        }
      }

      const settledRemaining = hold.balanceAfter;
      const usedThisMonth = org.ocrCreditsUsedThisMonth + credits;

      await org.update({ ocrCreditsUsedThisMonth: usedThisMonth }, { transaction });

      await OcrCreditTransactionModel.create(
        {
          id: createId(),
          organizationId: params.organizationId,
          claimId: params.claimId,
          extractionJobId: params.extractionJobId,
          type: "debit",
          pageCount: credits,
          credits,
          balanceAfter: settledRemaining,
          note: "extraction_success",
        } as any,
        { transaction },
      );

      await hold.destroy({ transaction });

      logger.info("OCR credits settled from hold", {
        organizationId: params.organizationId,
        claimId: params.claimId,
        extractionJobId: params.extractionJobId,
        credits,
        remaining: settledRemaining,
      });

      return { credits, remaining: settledRemaining };
    }

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

/** Return reserved credits when extraction permanently fails (idempotent). */
export async function releaseOcrCreditReservation(params: {
  organizationId: string;
  extractionJobId: string;
}): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    const hold = await OcrCreditTransactionModel.findOne({
      where: {
        extractionJobId: params.extractionJobId,
        type: "hold",
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!hold) return;

    const org = await OrganizationModel.findByPk(params.organizationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!org) return;

    const remaining = org.ocrCreditsRemaining + hold.credits;
    await org.update({ ocrCreditsRemaining: remaining }, { transaction });

    await OcrCreditTransactionModel.create(
      {
        id: createId(),
        organizationId: params.organizationId,
        claimId: hold.claimId,
        extractionJobId: params.extractionJobId,
        type: "release",
        pageCount: hold.credits,
        credits: hold.credits,
        balanceAfter: remaining,
        note: "extraction_failed",
      } as any,
      { transaction },
    );

    await hold.destroy({ transaction });

    logger.info("OCR credit reservation released", {
      organizationId: params.organizationId,
      extractionJobId: params.extractionJobId,
      credits: hold.credits,
      remaining,
    });
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
