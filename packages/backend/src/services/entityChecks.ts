import { prisma } from './db.js';

type ProjectVendorCheck = {
  projectExists: boolean;
  vendorExists: boolean;
};

export async function checkProjectAndVendor(
  projectId: string,
  vendorId: string,
): Promise<ProjectVendorCheck> {
  const [project, vendor] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    }),
    prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true },
    }),
  ]);
  return {
    projectExists: Boolean(project),
    vendorExists: Boolean(vendor),
  };
}
