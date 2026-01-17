export type ReadinessCheckResult = {
  ok: boolean;
  code?: string;
  error?: unknown;
};

export type ReadinessReport = {
  ok: boolean;
  checks: {
    db: ReadinessCheckResult;
  };
};

export type PublicReadinessReport = {
  ok: boolean;
  checks: {
    db: { ok: boolean; code?: string };
  };
};

export async function checkDatabaseReady(prismaClient: {
  $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
}): Promise<ReadinessCheckResult> {
  try {
    await prismaClient.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, code: 'db_unavailable', error: err };
  }
}

export async function getReadinessReport(prismaClient: {
  $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
}): Promise<ReadinessReport> {
  const db = await checkDatabaseReady(prismaClient);
  return { ok: db.ok, checks: { db } };
}

export function toPublicReadinessReport(
  report: ReadinessReport,
): PublicReadinessReport {
  const db: { ok: boolean; code?: string } = { ok: report.checks.db.ok };
  if (report.checks.db.code) db.code = report.checks.db.code;
  return {
    ok: report.ok,
    checks: {
      db,
    },
  };
}
