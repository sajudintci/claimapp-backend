import { OrganizationModel } from "@/database/models/organization.model";
import { getStorageService } from "@/storage/storage.factory";
import { buildOrganizationLogoUrl } from "@/utils/logo-url";

const LOGO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function updateOrganizationLogo(params: {
  organizationId: string;
  file: Express.Multer.File;
}): Promise<{ organizationLogoUrl: string | null }> {
  if (!LOGO_MIME_TYPES.has(params.file.mimetype)) {
    throw new Error("INVALID_LOGO_TYPE");
  }

  const org = await OrganizationModel.findByPk(params.organizationId);
  if (!org) {
    throw new Error("ORG_NOT_FOUND");
  }

  const storage = getStorageService();
  const saved = await storage.saveLogo(params.file);
  const previous = org.logoFileName;

  await OrganizationModel.update(
    { logoFileName: saved.fileName },
    { where: { id: params.organizationId } },
  );

  if (previous && previous !== saved.fileName) {
    await storage.deleteLogoFile(previous);
  }

  return { organizationLogoUrl: buildOrganizationLogoUrl(saved.fileName) };
}

export async function removeOrganizationLogo(params: {
  organizationId: string;
}): Promise<{ organizationLogoUrl: null }> {
  const org = await OrganizationModel.findByPk(params.organizationId);
  if (!org) {
    throw new Error("ORG_NOT_FOUND");
  }

  if (org.logoFileName) {
    await getStorageService().deleteLogoFile(org.logoFileName);
  }

  await OrganizationModel.update(
    { logoFileName: null },
    { where: { id: params.organizationId } },
  );

  return { organizationLogoUrl: null };
}
