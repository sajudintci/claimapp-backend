import { env } from "@/config/env";
import { logger } from "@/infrastructure/logger/winston";
import { abbyyCircuitBreaker } from "@/infrastructure/resilience/circuit-breakers";
import { abbyyBulkhead } from "@/infrastructure/resilience/bulkheads";
import { runWithBulkhead } from "@/infrastructure/resilience/cluster-bulkhead";

type VantageTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

type VantageSkill = {
  id: string;
  name?: string;
  type?: string;
};

type VantageResultFile = {
  fileId: string;
  fileName?: string;
  type?: string;
};

type VantageDocument = {
  id?: string;
  resultFiles?: VantageResultFile[];
};

type VantageTransaction = {
  id: string;
  status: string;
  error?: string | null;
  documents?: VantageDocument[];
};

let cachedToken: { value: string; expiresAtMs: number } | null = null;

function baseUrl(): string {
  return env.ABBYY_BASE_URL.replace(/\/$/, "");
}

function publicApiUrl(pathSuffix: string): string {
  return `${baseUrl()}/api/publicapi/v1${pathSuffix}`;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "openid permissions global.wildcard",
    client_id: env.ABBYY_CLIENT_ID,
    client_secret: env.ABBYY_CLIENT_SECRET,
  });

  const response = await fetch(`${baseUrl()}/auth2/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ABBYY auth failed (${response.status}): ${errText.slice(0, 500)}`);
  }

  const data = (await response.json()) as VantageTokenResponse;
  if (!data.access_token) {
    throw new Error("ABBYY auth response missing access_token");
  }

  const ttlSec = Number(data.expires_in ?? 3600);
  cachedToken = {
    value: data.access_token,
    expiresAtMs: Date.now() + ttlSec * 1000,
  };

  return cachedToken.value;
}

export async function listAbbyySkills(): Promise<VantageSkill[]> {
  const token = await getAccessToken();
  const response = await fetch(publicApiUrl("/skills"), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `ABBYY list skills failed (${response.status}): ${errText.slice(0, 300)}. Set ABBYY_SKILL_ID manually from Vantage Skill Catalog.`,
    );
  }

  const data = (await response.json()) as VantageSkill[];
  return Array.isArray(data) ? data : [];
}

export async function resolveAbbyySkillId(): Promise<string> {
  if (env.ABBYY_SKILL_ID.trim()) {
    return env.ABBYY_SKILL_ID.trim();
  }

  const skills = await listAbbyySkills();
  const nameNeedle = env.ABBYY_SKILL_NAME.trim().toLowerCase();

  const byName = skills.find((skill) => skill.name?.toLowerCase() === nameNeedle);
  if (byName) return byName.id;

  const byPartial = skills.find(
    (skill) =>
      skill.name?.toLowerCase().includes(nameNeedle) ||
      skill.id?.toLowerCase() === nameNeedle,
  );
  if (byPartial) return byPartial.id;

  const ocrSkill = skills.find(
    (skill) =>
      skill.type?.toLowerCase() === "ocr" ||
      skill.name?.toLowerCase().includes("ocr"),
  );
  if (ocrSkill) return ocrSkill.id;

  const documentSkill = skills.find((skill) => skill.type?.toLowerCase() === "document");
  if (documentSkill) return documentSkill.id;

  throw new Error(
    `Could not resolve ABBYY skill. Available: ${skills.map((s) => `${s.name ?? "?"}(${s.id})`).join(", ") || "none"}. Set ABBYY_SKILL_ID in .env`,
  );
}

async function launchTransaction(
  token: string,
  skillId: string,
  file: { buffer: Buffer; mimeType: string; fileName: string },
): Promise<string> {
  const form = new FormData();
  form.append("Model", JSON.stringify({ files: [{}] }));
  form.append("Files", new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.fileName);

  const response = await fetch(
    `${publicApiUrl("/transactions/launch")}?skillId=${encodeURIComponent(skillId)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ABBYY launch failed (${response.status}): ${errText.slice(0, 800)}`);
  }

  const data = (await response.json()) as { id?: string; transactionId?: string };
  const transactionId = data.id ?? data.transactionId;
  if (!transactionId) {
    throw new Error("ABBYY launch response missing transaction id");
  }

  return transactionId;
}

async function getTransaction(token: string, transactionId: string): Promise<VantageTransaction> {
  const response = await fetch(publicApiUrl(`/transactions/${transactionId}`), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ABBYY get transaction failed (${response.status}): ${errText.slice(0, 500)}`);
  }

  return (await response.json()) as VantageTransaction;
}

async function waitForTransaction(token: string, transactionId: string): Promise<VantageTransaction> {
  const deadline = Date.now() + env.ABBYY_TRANSACTION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const transaction = await getTransaction(token, transactionId);
    const status = transaction.status;

    if (status === "Processed") return transaction;
    if (status === "Failed" || status === "Canceled") {
      throw new Error(
        `ABBYY transaction ${status}${transaction.error ? `: ${transaction.error}` : ""}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, env.ABBYY_POLL_INTERVAL_MS));
  }

  throw new Error(
    `ABBYY transaction timed out after ${env.ABBYY_TRANSACTION_TIMEOUT_MS}ms (id=${transactionId})`,
  );
}

async function downloadResultFile(
  token: string,
  transactionId: string,
  fileId: string,
): Promise<{ contentType: string; body: string }> {
  const response = await fetch(
    publicApiUrl(`/transactions/${transactionId}/files/${fileId}/download`),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ABBYY download failed (${response.status}): ${errText.slice(0, 300)}`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const body = await response.text();
  return { contentType, body };
}

function collectResultFileIds(transaction: VantageTransaction): VantageResultFile[] {
  const files: VantageResultFile[] = [];
  for (const doc of transaction.documents ?? []) {
    for (const file of doc.resultFiles ?? []) {
      if (file.fileId) files.push(file);
    }
  }
  return files;
}

export type AbbyyProcessResult = {
  transactionId: string;
  skillId: string;
  rawResults: Array<{
    fileId: string;
    fileName?: string;
    type?: string;
    contentType: string;
    body: string;
  }>;
};

export async function processDocumentWithAbbyy(
  file: { buffer: Buffer; mimeType: string; originalFileName?: string },
): Promise<AbbyyProcessResult> {
  return abbyyCircuitBreaker.execute(() =>
    runWithBulkhead(
      abbyyBulkhead,
      {
        acquireTimeoutMs: env.BULKHEAD_ABBYY_ACQUIRE_TIMEOUT_MS,
        clusterTtlMs: env.ABBYY_TRANSACTION_TIMEOUT_MS,
      },
      async () => {
      const token = await getAccessToken();
      const skillId = await resolveAbbyySkillId();
      const fileName = file.originalFileName?.trim() || "document";

      logger.info("ABBYY Vantage launch", { mimeType: file.mimeType, skillId, fileName });

      const transactionId = await launchTransaction(token, skillId, {
        buffer: file.buffer,
        mimeType: file.mimeType,
        fileName,
      });
      const transaction = await waitForTransaction(token, transactionId);
      const resultFiles = collectResultFileIds(transaction);

      if (resultFiles.length === 0) {
        throw new Error("ABBYY transaction completed but no result files returned");
      }

      const rawResults: AbbyyProcessResult["rawResults"] = [];
      for (const file of resultFiles) {
        const downloaded = await downloadResultFile(token, transactionId, file.fileId);
        rawResults.push({
          fileId: file.fileId,
          fileName: file.fileName,
          type: file.type,
          contentType: downloaded.contentType,
          body: downloaded.body,
        });
      }

      logger.info("ABBYY Vantage completed", {
        transactionId,
        skillId,
        resultFileCount: rawResults.length,
      });

      return { transactionId, skillId, rawResults };
      },
    ),
  );
}
