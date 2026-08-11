import type {
  KnowledgeLlmBudgetPort,
  KnowledgeLlmBudgetResult,
  KnowledgeLlmReservationCommand,
  KnowledgeLlmReservationRecord,
  KnowledgeLlmReservationRequest,
} from './knowledgeLlmBudgetPorts.js';
import {
  ceilCostMicros,
  knowledgeLlmLimits,
  maximumReservationMicros,
  type KnowledgeLlmModelCatalog,
} from './knowledgeLlmConfig.js';

const sha256Pattern = /^[0-9a-f]{64}$/;
const maximumDatabaseBigInt = 9_223_372_036_854_775_807n;

function boundedIdentifier(value: string, maximum: number): boolean {
  const hasControl = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  return (
    value === value.trim() &&
    value.length > 0 &&
    [...value].length <= maximum &&
    !hasControl
  );
}

function invalid(): KnowledgeLlmBudgetResult<never> {
  return {
    ok: false,
    error: { status: 400, code: 'invalid_request', message: 'Invalid request' },
  };
}

function validInput(input: KnowledgeLlmReservationRequest): boolean {
  let expectedMaximumCost: bigint;
  try {
    expectedMaximumCost =
      ceilCostMicros(
        input.estimatedInputTokens,
        input.inputCostMicrosPerMillion,
      ) +
      ceilCostMicros(input.maxOutputTokens, input.outputCostMicrosPerMillion);
  } catch {
    return false;
  }
  if (
    !boundedIdentifier(input.runId, 255) ||
    !boundedIdentifier(input.actor.userId, 200) ||
    (input.provider !== 'stub' && input.provider !== 'openai') ||
    !boundedIdentifier(input.model, 200) ||
    input.inputCostMicrosPerMillion < 0n ||
    input.inputCostMicrosPerMillion > maximumDatabaseBigInt ||
    input.outputCostMicrosPerMillion < 0n ||
    input.outputCostMicrosPerMillion > maximumDatabaseBigInt ||
    input.maximumCostMicros < 0n ||
    input.maximumCostMicros > maximumDatabaseBigInt ||
    input.maximumCostMicros !== expectedMaximumCost ||
    !/^[A-Z]{3}$/.test(input.currency) ||
    !sha256Pattern.test(input.requestKeyHash) ||
    !sha256Pattern.test(input.requestPayloadHash) ||
    !sha256Pattern.test(input.selectedContextFingerprint) ||
    !Number.isSafeInteger(input.catalogVersion) ||
    input.catalogVersion < 1 ||
    !Number.isSafeInteger(input.promptTemplateVersion) ||
    input.promptTemplateVersion < 1 ||
    !Number.isSafeInteger(input.estimatedInputTokens) ||
    input.estimatedInputTokens < 1 ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > knowledgeLlmLimits.maximumOutputTokens ||
    Number.isNaN(input.now.getTime())
  ) {
    return false;
  }
  if (input.scope === 'personal') {
    return input.organizationId === null;
  }
  return (
    input.scope === 'organization' &&
    typeof input.organizationId === 'string' &&
    boundedIdentifier(input.organizationId, 200) &&
    input.organizationId === input.actor.organizationId
  );
}

export function createKnowledgeLlmBudgetUseCases(
  port: KnowledgeLlmBudgetPort,
  catalog: KnowledgeLlmModelCatalog | null,
) {
  const catalogSnapshot =
    catalog === null
      ? null
      : {
          version: catalog.version,
          models: catalog.models.map((model) => ({ ...model })),
        };
  return {
    async reserve(
      input: KnowledgeLlmReservationCommand,
    ): Promise<KnowledgeLlmBudgetResult<KnowledgeLlmReservationRecord>> {
      const model = catalogSnapshot?.models.find(
        (candidate) =>
          candidate.enabled &&
          candidate.provider === input.provider &&
          candidate.model === input.model,
      );
      if (
        !catalogSnapshot ||
        !model ||
        input.catalogVersion !== catalogSnapshot.version ||
        input.estimatedInputTokens > model.maxInputTokens ||
        input.maxOutputTokens > model.maxOutputTokens
      ) {
        return invalid();
      }
      let maximumCostMicros: bigint;
      try {
        maximumCostMicros = maximumReservationMicros({
          model,
          estimatedInputTokens: input.estimatedInputTokens,
          maxOutputTokens: input.maxOutputTokens,
        });
      } catch {
        return invalid();
      }
      const resolved: KnowledgeLlmReservationRequest = {
        ...input,
        catalogVersion: catalogSnapshot.version,
        inputCostMicrosPerMillion: model.inputCostMicrosPerMillion,
        outputCostMicrosPerMillion: model.outputCostMicrosPerMillion,
        maximumCostMicros,
        currency: model.currency,
      };
      if (!validInput(resolved)) return invalid();
      return port.reserve(resolved);
    },
  };
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function localMidnightUtc(year: number, month: number, timezone: string): Date {
  const desired = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    );
    candidate += desired - represented;
  }
  return new Date(candidate);
}

export function knowledgeLlmMonthlyPeriod(
  now: Date,
  timezone: string,
): { start: Date; end: Date } {
  if (Number.isNaN(now.getTime())) throw new Error('invalid_date');
  // Throws RangeError for unknown IANA zones; callers fail closed.
  const current = zonedParts(now, timezone);
  const nextMonth = current.month === 12 ? 1 : current.month + 1;
  const nextYear = current.month === 12 ? current.year + 1 : current.year;
  return {
    start: localMidnightUtc(current.year, current.month, timezone),
    end: localMidnightUtc(nextYear, nextMonth, timezone),
  };
}
