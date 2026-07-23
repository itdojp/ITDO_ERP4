type RateLimitRedisClient = {
  disconnect: () => void;
  quit: () => Promise<unknown>;
};

export type BackendResources = {
  closeNotifier: () => Promise<void>;
  disconnectPrisma: () => Promise<void>;
  rateLimitRedisClient: RateLimitRedisClient | null;
};

type BackendResourceName = 'notifier' | 'prisma' | 'rate-limit-redis';

export class BackendResourceCleanupError extends Error {
  readonly resources: BackendResourceName[];

  constructor(resources: BackendResourceName[]) {
    super('backend resource cleanup failed');
    this.name = 'BackendResourceCleanupError';
    this.resources = resources;
  }
}

async function closeRateLimitRedisClient(
  client: RateLimitRedisClient,
): Promise<void> {
  try {
    await client.quit();
  } catch (err) {
    client.disconnect();
    throw err;
  }
}

export async function closeBackendResources(
  resources: BackendResources,
): Promise<void> {
  const operations: Array<{
    name: BackendResourceName;
    close: () => Promise<unknown>;
  }> = [
    { name: 'notifier', close: resources.closeNotifier },
    { name: 'prisma', close: resources.disconnectPrisma },
  ];
  if (resources.rateLimitRedisClient) {
    const redisClient = resources.rateLimitRedisClient;
    operations.push({
      name: 'rate-limit-redis',
      close: () => closeRateLimitRedisClient(redisClient),
    });
  }

  const results = await Promise.allSettled(
    operations.map((operation) => operation.close()),
  );
  const failedResources = results.flatMap((result, index) =>
    result.status === 'rejected' ? [operations[index].name] : [],
  );
  if (failedResources.length > 0) {
    throw new BackendResourceCleanupError(failedResources);
  }
}
