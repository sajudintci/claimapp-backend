type SettingsPayload = {
  timezone: string;
  currency: string;
  sessionTimeoutMinutes: number;
  suspiciousLoginAlert: boolean;
};

const defaults: SettingsPayload = {
  timezone: "Asia/Jakarta",
  currency: "IDR",
  sessionTimeoutMinutes: 30,
  suspiciousLoginAlert: true,
};

const byOrg = new Map<string, SettingsPayload>();

export type OrganizationSettings = SettingsPayload & {
  organizationName: string;
  organizationCode: string;
  organizationLogoUrl: string | null;
  ocrCreditsRemaining: number;
  ocrMonthlyQuota: number;
  ocrCreditsUsedThisMonth: number;
};

export const getOrgPreferences = (orgId: string) => byOrg.get(orgId) ?? defaults;

export const updateOrgPreferences = (orgId: string, patch: Partial<SettingsPayload>) => {
  const existing = getOrgPreferences(orgId);
  const merged = { ...existing, ...patch };
  byOrg.set(orgId, merged);
  return merged;
};
