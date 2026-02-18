type ApiResponse = {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
  json(): Promise<any>;
};

type ApiRequest = {
  get(url: string, options?: any): Promise<ApiResponse>;
  post(url: string, options?: any): Promise<ApiResponse>;
};

type CreateProjectAndEstimateOptions = {
  request: ApiRequest;
  apiBase: string;
  headers: Record<string, string>;
  project: {
    code: string;
    name: string;
    status?: string;
  };
  estimate: {
    totalAmount: number;
    currency?: string;
    notes?: string;
  };
};

type SubmitAndFindApprovalInstanceOptions = {
  request: ApiRequest;
  apiBase: string;
  headers: Record<string, string>;
  flowType: string;
  projectId: string;
  targetTable: string;
  targetId: string;
  submitData?: Record<string, unknown>;
};

async function ensureOk(res: ApiResponse) {
  if (res.ok()) return;
  const body = await res.text();
  throw new Error(`[e2e] api failed: ${res.status()} ${body}`);
}
export { ensureOk };

export async function createProjectAndEstimate(
  options: CreateProjectAndEstimateOptions,
) {
  const projectRes = await options.request.post(`${options.apiBase}/projects`, {
    data: {
      code: options.project.code,
      name: options.project.name,
      status: options.project.status ?? 'active',
    },
    headers: options.headers,
  });
  await ensureOk(projectRes);
  const projectPayload = await projectRes.json();
  const projectId = (projectPayload?.id ??
    projectPayload?.project?.id ??
    '') as string;
  if (!projectId) {
    throw new Error(
      `[e2e] project id missing: ${JSON.stringify(projectPayload)}`,
    );
  }

  const estimateRes = await options.request.post(
    `${options.apiBase}/projects/${encodeURIComponent(projectId)}/estimates`,
    {
      data: {
        totalAmount: options.estimate.totalAmount,
        currency: options.estimate.currency ?? 'JPY',
        notes: options.estimate.notes ?? '',
      },
      headers: options.headers,
    },
  );
  await ensureOk(estimateRes);
  const estimatePayload = await estimateRes.json();
  const estimateId = (estimatePayload?.id ??
    estimatePayload?.estimate?.id ??
    '') as string;
  if (!estimateId) {
    throw new Error(
      `[e2e] estimate id missing: ${JSON.stringify(estimatePayload)}`,
    );
  }

  return { projectId, estimateId };
}

export async function submitAndFindApprovalInstance(
  options: SubmitAndFindApprovalInstanceOptions,
) {
  const submitOptions: { headers: Record<string, string>; data?: unknown } = {
    headers: options.headers,
  };
  if (options.submitData !== undefined) {
    submitOptions.data = options.submitData;
  }
  const submitRes = await options.request.post(
    `${options.apiBase}/${options.targetTable}/${encodeURIComponent(options.targetId)}/submit`,
    submitOptions,
  );
  await ensureOk(submitRes);

  const instancesRes = await options.request.get(
    `${options.apiBase}/approval-instances?flowType=${encodeURIComponent(options.flowType)}&projectId=${encodeURIComponent(options.projectId)}`,
    { headers: options.headers },
  );
  await ensureOk(instancesRes);
  const instancesPayload = await instancesRes.json();
  const approval = (instancesPayload?.items ?? []).find(
    (item: any) =>
      item?.targetTable === options.targetTable &&
      item?.targetId === options.targetId &&
      item?.status !== 'approved' &&
      item?.status !== 'rejected' &&
      item?.status !== 'cancelled',
  );

  if (!approval?.id) {
    throw new Error(
      `[e2e] approval instance missing: ${JSON.stringify(instancesPayload)}`,
    );
  }
  return approval as {
    id: string;
    currentStep?: number | null;
    status?: string;
  };
}
