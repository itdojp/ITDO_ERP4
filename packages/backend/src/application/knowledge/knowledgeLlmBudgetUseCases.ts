import { createHash } from 'node:crypto';

import {
  externalLlmConservativeInputTokens,
  externalLlmTextRequestFingerprint,
  type ExternalLlmTextRequest,
} from '../externalLlm/externalLlmPort.js';

import type {
  KnowledgeLlmBudgetPort,
  KnowledgeLlmBudgetResult,
  KnowledgeLlmClock,
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
import {
  deriveKnowledgeLlmSelectedContext,
  validKnowledgeLlmContextFingerprintSources,
} from './knowledgeLlmContext.js';
import { normalizeAuthIdentifier } from '../../services/authIdentifiers.js';

const sha256Pattern = /^[0-9a-f]{64}$/;
const maximumDatabaseBigInt = 9_223_372_036_854_775_807n;

function updateHashField(hash: ReturnType<typeof createHash>, value: string) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function reservationPayloadHash(
  input: KnowledgeLlmReservationCommand,
  selectedContextFingerprint: string,
  providerRequestHash: string,
  economics: {
    estimatedInputTokens: number;
    inputCostMicrosPerMillion: bigint;
    outputCostMicrosPerMillion: bigint;
    maximumCostMicros: bigint;
    currency: string;
  },
) {
  const hash = createHash('sha256');
  hash.update('erp4:knowledge:llm-reservation-payload:v1\0', 'utf8');
  for (const value of [
    input.scope,
    input.organizationId ?? '',
    input.provider,
    input.model,
    String(input.catalogVersion),
    String(input.promptTemplateVersion),
    selectedContextFingerprint,
    providerRequestHash,
    String(input.maxOutputTokens),
    String(economics.estimatedInputTokens),
    economics.inputCostMicrosPerMillion.toString(),
    economics.outputCostMicrosPerMillion.toString(),
    economics.maximumCostMicros.toString(),
    economics.currency,
  ]) {
    updateHashField(hash, value);
  }
  return hash.digest('hex');
}

export const knowledgeLlmTemperatureBasisPoints = 0;

export function buildKnowledgeLlmExternalRequest(input: {
  provider: ExternalLlmTextRequest['provider'];
  model: string;
  systemPrompt: string;
  userPrompt: string;
  contextSections: readonly string[];
  maxOutputTokens: number;
}): ExternalLlmTextRequest {
  return {
    ...input,
    temperatureBasisPoints: knowledgeLlmTemperatureBasisPoints,
  };
}

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

function validAuthIdentifier(value: string, maximum: number): boolean {
  try {
    return normalizeAuthIdentifier(value, maximum) === value;
  } catch {
    return false;
  }
}

function invalid(): KnowledgeLlmBudgetResult<never> {
  return {
    ok: false,
    error: { status: 400, code: 'invalid_request', message: 'Invalid request' },
  };
}

function trustedTimestamp(clock: KnowledgeLlmClock): Date {
  const timestamp = clock();
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
    throw new Error('knowledge_llm_clock_invalid');
  }
  return new Date(timestamp.getTime());
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
    !validAuthIdentifier(input.actor.userId, 200) ||
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
    !sha256Pattern.test(input.providerRequestHash) ||
    !sha256Pattern.test(input.selectedContextFingerprint) ||
    !validKnowledgeLlmContextFingerprintSources(
      input.selectedContextSources,
      input.selectedContextFingerprint,
    ) ||
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
    validAuthIdentifier(input.organizationId, 200) &&
    input.organizationId === input.actor.organizationId
  );
}

export function createKnowledgeLlmBudgetUseCases(
  port: KnowledgeLlmBudgetPort,
  catalog: KnowledgeLlmModelCatalog | null,
  clock: KnowledgeLlmClock = () => new Date(),
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
      if (
        typeof input.systemPrompt !== 'string' ||
        typeof input.userPrompt !== 'string' ||
        Buffer.byteLength(input.systemPrompt, 'utf8') >
          knowledgeLlmLimits.systemPromptBytes ||
        Buffer.byteLength(input.userPrompt, 'utf8') >
          knowledgeLlmLimits.userPromptBytes ||
        !Array.isArray(input.selectedContextSources) ||
        (input.reservationInputTokenFloor !== undefined &&
          (!Number.isSafeInteger(input.reservationInputTokenFloor) ||
            input.reservationInputTokenFloor < 1))
      ) {
        return invalid();
      }
      let selectedContext: ReturnType<typeof deriveKnowledgeLlmSelectedContext>;
      let estimatedInputTokens: number;
      let providerRequestHash: string;
      try {
        selectedContext = deriveKnowledgeLlmSelectedContext(
          input.selectedContextSources,
        );
        const providerRequest = buildKnowledgeLlmExternalRequest({
          provider: input.provider,
          model: input.model,
          systemPrompt: input.systemPrompt,
          userPrompt: input.userPrompt,
          contextSections: selectedContext.representations,
          maxOutputTokens: input.maxOutputTokens,
        });
        const derivedEstimate = externalLlmConservativeInputTokens(
          providerRequest,
          knowledgeLlmLimits.sourceFramingTokens,
        );
        providerRequestHash =
          externalLlmTextRequestFingerprint(providerRequest);
        estimatedInputTokens = Math.max(
          derivedEstimate,
          input.reservationInputTokenFloor ?? derivedEstimate,
        );
      } catch {
        return invalid();
      }
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
        estimatedInputTokens > model.maxInputTokens ||
        input.maxOutputTokens > model.maxOutputTokens
      ) {
        return invalid();
      }
      let maximumCostMicros: bigint;
      try {
        maximumCostMicros = maximumReservationMicros({
          model,
          estimatedInputTokens,
          maxOutputTokens: input.maxOutputTokens,
        });
      } catch {
        return invalid();
      }
      const resolved: KnowledgeLlmReservationRequest = {
        runId: input.runId,
        actor: input.actor,
        auditActor: input.auditActor,
        scope: input.scope,
        organizationId: input.organizationId,
        provider: input.provider,
        model: input.model,
        catalogVersion: catalogSnapshot.version,
        promptTemplateVersion: input.promptTemplateVersion,
        requestKeyHash: input.requestKeyHash,
        requestPayloadHash: reservationPayloadHash(
          input,
          selectedContext.fingerprint,
          providerRequestHash,
          {
            estimatedInputTokens,
            inputCostMicrosPerMillion: model.inputCostMicrosPerMillion,
            outputCostMicrosPerMillion: model.outputCostMicrosPerMillion,
            maximumCostMicros,
            currency: model.currency,
          },
        ),
        providerRequestHash,
        selectedContextFingerprint: selectedContext.fingerprint,
        selectedContextSources: selectedContext.sources,
        estimatedInputTokens,
        maxOutputTokens: input.maxOutputTokens,
        inputCostMicrosPerMillion: model.inputCostMicrosPerMillion,
        outputCostMicrosPerMillion: model.outputCostMicrosPerMillion,
        maximumCostMicros,
        currency: model.currency,
        now: trustedTimestamp(clock),
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

  const expected: ZonedParts = {
    year,
    month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  };
  const matchesExpected = (value: number) => {
    const parts = zonedParts(new Date(value), timezone);
    return (Object.keys(expected) as Array<keyof ZonedParts>).every(
      (key) => parts[key] === expected[key],
    );
  };

  // PostgreSQL resolves an ambiguous local timestamp to the later UTC
  // instant. Probe the offset regimes around the boundary and choose that
  // same canonical instant so application and DB checks cannot disagree at a
  // midnight fall-back (for example America/Havana 2020-11-01).
  const matchingCandidates = new Set<number>();
  for (
    let offsetProbe = -48 * 60 * 60 * 1000;
    offsetProbe <= 48 * 60 * 60 * 1000;
    offsetProbe += 6 * 60 * 60 * 1000
  ) {
    const probe = candidate + offsetProbe;
    const parts = zonedParts(new Date(probe), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    );
    const possible = desired - (represented - probe);
    if (matchesExpected(possible)) matchingCandidates.add(possible);
  }
  if (matchesExpected(candidate)) matchingCandidates.add(candidate);
  if (matchingCandidates.size === 0) {
    throw new Error('invalid_timezone_month_boundary');
  }
  return new Date(Math.max(...matchingCandidates));
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
