import { createHash, randomUUID } from 'node:crypto';

import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import {
  KnowledgeConversationImportConflictError,
  knowledgeConversationImportLimits,
  type CanonicalKnowledgeConversationImport,
  type KnowledgeConversationImportResult,
  type KnowledgeConversationImportUnitOfWork,
} from './knowledgeConversationImportPorts.js';
import {
  bindKnowledgeConversationImportToOwner,
  KnowledgeConversationImportParserError,
  parseKnowledgeConversationImport,
} from './knowledgeConversationImportParser.js';
import {
  KnowledgeConversationImportTokenError,
  createKnowledgeConversationImportTokenCodec,
} from './knowledgeConversationImportToken.js';
import {
  hasKnowledgePrincipal,
  knowledgeProvenanceAuditActor,
} from './knowledgeProvenanceValidation.js';

type ImportFailureCode =
  | 'invalid_import'
  | 'import_oversize'
  | 'preview_token_invalid'
  | 'preview_token_expired'
  | 'not_found'
  | 'idempotency_conflict'
  | 'import_conflict';

export type KnowledgeConversationImportUseCaseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      statusCode: 400 | 404 | 409;
      code: ImportFailureCode;
      message: string;
    };

type TokenCodec = ReturnType<
  typeof createKnowledgeConversationImportTokenCodec
>;

function ok<T>(value: T): KnowledgeConversationImportUseCaseResult<T> {
  return { ok: true, value };
}

function failure(
  statusCode: 400 | 404 | 409,
  code: ImportFailureCode,
  message: string,
): KnowledgeConversationImportUseCaseResult<never> {
  return { ok: false, statusCode, code, message };
}

function parserFailure(error: KnowledgeConversationImportParserError) {
  const oversize = new Set([
    'input_oversize',
    'conversation_oversize',
    'turn_limit_exceeded',
    'linked_item_limit_exceeded',
    'json_limit_exceeded',
  ]).has(error.code);
  return failure(
    400,
    oversize ? 'import_oversize' : 'invalid_import',
    oversize ? 'Import limit exceeded' : 'Invalid import',
  );
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  return Object.keys(record).some((key) => !allowed.has(key)) ? null : record;
}

function validRequestKey(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    [...value].length > knowledgeConversationImportLimits.requestKeyCodePoints
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code < 0x20 ||
      code === 0x7f ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    ) {
      return false;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function hashKnowledgeConversationImportRequestKey(
  actor: KnowledgeActor,
  requestKey: string,
) {
  return createHash('sha256')
    .update('erp4:knowledge:conversation-import-request-key:v1\0', 'utf8')
    .update(actor.userId, 'utf8')
    .update('\0', 'utf8')
    .update(requestKey, 'utf8')
    .digest('hex');
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function summary(canonical: CanonicalKnowledgeConversationImport) {
  return {
    format: canonical.format,
    title: canonical.title,
    provider: canonical.provider,
    model: canonical.model,
    roles: unique(canonical.turns.map((turn) => turn.role)),
    origins: unique(canonical.turns.map((turn) => turn.origin)),
    turnCount: canonical.turns.length,
    linkedItemCount: canonical.linkedItems.length,
  };
}

function resultFromRecord(
  record: {
    conversationId: string;
    turnCount: number;
    linkedItemCount: number;
  },
  created: boolean,
): KnowledgeConversationImportResult {
  return {
    conversationId: record.conversationId,
    created,
    reused: !created,
    turnCount: record.turnCount,
    linkedItemCount: record.linkedItemCount,
  };
}

export function createKnowledgeConversationImportUseCases(dependencies: {
  unitOfWork: KnowledgeConversationImportUnitOfWork;
  tokenCodec?: TokenCodec;
  now?: () => Date;
  randomId?: () => string;
}) {
  const tokenCodec =
    dependencies.tokenCodec ?? createKnowledgeConversationImportTokenCodec();
  const now = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? randomUUID;

  async function auditRejected(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    importId: string;
    canonical?: CanonicalKnowledgeConversationImport;
  }) {
    await dependencies.unitOfWork.run(async (transaction) => {
      await transaction.audit.write({
        action: 'knowledge_import_rejected',
        actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
        targetTable: 'knowledge_imports',
        targetId: input.importId,
        metadata: input.canonical
          ? {
              format: input.canonical.format,
              turnCount: input.canonical.turns.length,
              itemCount: input.canonical.linkedItems.length,
              duplicate: false,
            }
          : { duplicate: false },
      });
    });
  }

  async function parseOrReject(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    payload: unknown;
    importId: string;
  }) {
    try {
      const parsed = parseKnowledgeConversationImport(input.payload);
      return {
        parsed: {
          ...parsed,
          canonical: bindKnowledgeConversationImportToOwner(
            parsed.canonical,
            input.actor.userId,
          ),
        },
        error: null,
      } as const;
    } catch (error) {
      if (!(error instanceof KnowledgeConversationImportParserError))
        throw error;
      await auditRejected(input);
      return { parsed: null, error: parserFailure(error) } as const;
    }
  }

  return {
    async preview(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      body: unknown;
    }): Promise<KnowledgeConversationImportUseCaseResult<unknown>> {
      if (!hasKnowledgePrincipal(input.actor)) {
        return failure(404, 'not_found', 'Not found');
      }
      const importId = randomId();
      const parsed = await parseOrReject({
        actor: input.actor,
        auditActor: input.auditActor,
        payload: input.body,
        importId,
      });
      if (parsed.error) return parsed.error;
      const token = tokenCodec.create({
        actor: input.actor,
        canonical: parsed.parsed.canonical,
      });
      const previewResult = await dependencies.unitOfWork.run(
        async (transaction) => {
          const accessible = await transaction.imports.checkOwnedItems({
            actor: input.actor,
            itemIds: parsed.parsed.canonical.linkedItems
              .map((item) => item.itemId)
              .sort(),
          });
          if (!accessible) {
            await transaction.audit.write({
              action: 'knowledge_import_rejected',
              actor: knowledgeProvenanceAuditActor(
                input.actor,
                input.auditActor,
              ),
              targetTable: 'knowledge_imports',
              targetId: token.importId,
              metadata: {
                format: parsed.parsed.canonical.format,
                turnCount: parsed.parsed.canonical.turns.length,
                itemCount: parsed.parsed.canonical.linkedItems.length,
                duplicate: false,
              },
            });
            return null;
          }
          await transaction.audit.write({
            action: 'knowledge_import_previewed',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_imports',
            targetId: token.importId,
            metadata: {
              format: parsed.parsed.canonical.format,
              turnCount: parsed.parsed.canonical.turns.length,
              itemCount: parsed.parsed.canonical.linkedItems.length,
              duplicate: false,
            },
          });
          return {
            summary: summary(parsed.parsed.canonical),
            warnings: parsed.parsed.warnings,
            rejectedFields: parsed.parsed.rejectedFields,
            previewToken: token.token,
            expiresAt: token.expiresAt.toISOString(),
          };
        },
      );
      return previewResult
        ? ok(previewResult)
        : failure(404, 'not_found', 'Not found');
    },

    async commit(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      body: unknown;
    }): Promise<KnowledgeConversationImportUseCaseResult<unknown>> {
      if (!hasKnowledgePrincipal(input.actor)) {
        return failure(404, 'not_found', 'Not found');
      }
      const record = exactRecord(input.body, [
        'format',
        'inputBase64',
        'linkedItems',
        'previewToken',
        'requestKey',
      ]);
      const rejectionId = randomId();
      if (!record || !validRequestKey(record.requestKey)) {
        await auditRejected({
          actor: input.actor,
          auditActor: input.auditActor,
          importId: rejectionId,
        });
        return failure(400, 'invalid_import', 'Invalid import');
      }
      const payload = {
        format: record.format,
        inputBase64: record.inputBase64,
        linkedItems: record.linkedItems,
      };
      const parsed = await parseOrReject({
        actor: input.actor,
        auditActor: input.auditActor,
        payload,
        importId: rejectionId,
      });
      if (parsed.error) return parsed.error;
      let token;
      try {
        token = tokenCodec.verify({
          actor: input.actor,
          canonical: parsed.parsed.canonical,
          token: record.previewToken,
        });
      } catch (error) {
        if (!(error instanceof KnowledgeConversationImportTokenError))
          throw error;
        await auditRejected({
          actor: input.actor,
          auditActor: input.auditActor,
          importId: rejectionId,
          canonical: parsed.parsed.canonical,
        });
        return failure(
          400,
          error.code,
          error.code === 'preview_token_expired'
            ? 'Preview token expired'
            : 'Invalid preview token',
        );
      }
      const hashedRequestKey = hashKnowledgeConversationImportRequestKey(
        input.actor,
        record.requestKey,
      );
      const ledgerId = randomId();
      const conversationId = randomId();
      const itemIds = parsed.parsed.canonical.linkedItems.map(() => randomId());
      const turnIds = parsed.parsed.canonical.turns.map(() => randomId());
      const importedAt = now();
      try {
        return await dependencies.unitOfWork.run(async (transaction) => {
          const accessible = await transaction.imports.lockOwnedItems({
            actor: input.actor,
            itemIds: parsed.parsed.canonical.linkedItems
              .map((item) => item.itemId)
              .sort(),
          });
          if (!accessible) {
            await transaction.audit.write({
              action: 'knowledge_import_rejected',
              actor: knowledgeProvenanceAuditActor(
                input.actor,
                input.auditActor,
              ),
              targetTable: 'knowledge_imports',
              targetId: token.importId,
              metadata: {
                format: parsed.parsed.canonical.format,
                turnCount: parsed.parsed.canonical.turns.length,
                itemCount: parsed.parsed.canonical.linkedItems.length,
                duplicate: false,
              },
            });
            return failure(404, 'not_found', 'Not found');
          }
          const existingRequest = await transaction.imports.findRequest({
            actor: input.actor,
            requestKeyHash: hashedRequestKey,
          });
          if (existingRequest) {
            if (
              existingRequest.canonicalPayloadHash !==
                parsed.parsed.canonical.canonicalPayloadHash ||
              existingRequest.sourceType !== parsed.parsed.canonical.format ||
              existingRequest.conversationDeleted
            ) {
              await transaction.audit.write({
                action: 'knowledge_import_rejected',
                actor: knowledgeProvenanceAuditActor(
                  input.actor,
                  input.auditActor,
                ),
                targetTable: 'knowledge_imports',
                targetId: existingRequest.id,
                metadata: {
                  format: parsed.parsed.canonical.format,
                  turnCount: parsed.parsed.canonical.turns.length,
                  itemCount: parsed.parsed.canonical.linkedItems.length,
                  duplicate: true,
                },
              });
              return failure(
                409,
                'idempotency_conflict',
                'Idempotency conflict',
              );
            }
            await transaction.audit.write({
              action: 'knowledge_import_duplicate_detected',
              actor: knowledgeProvenanceAuditActor(
                input.actor,
                input.auditActor,
              ),
              targetTable: 'knowledge_imports',
              targetId: existingRequest.id,
              metadata: {
                format: existingRequest.sourceType,
                turnCount: existingRequest.turnCount,
                itemCount: existingRequest.linkedItemCount,
                duplicate: true,
              },
            });
            return ok(resultFromRecord(existingRequest, false));
          }
          const existingConversation =
            await transaction.imports.findConversationByPayload({
              actor: input.actor,
              canonicalPayloadHash:
                parsed.parsed.canonical.canonicalPayloadHash,
            });
          if (existingConversation) {
            if (existingConversation.conversationDeleted) {
              await transaction.audit.write({
                action: 'knowledge_import_rejected',
                actor: knowledgeProvenanceAuditActor(
                  input.actor,
                  input.auditActor,
                ),
                targetTable: 'knowledge_imports',
                targetId: token.importId,
                metadata: {
                  format: parsed.parsed.canonical.format,
                  turnCount: parsed.parsed.canonical.turns.length,
                  itemCount: parsed.parsed.canonical.linkedItems.length,
                  duplicate: true,
                },
              });
              return failure(409, 'import_conflict', 'Import conflict');
            }
            const bound = await transaction.imports.bindRequestToConversation({
              actor: input.actor,
              ledgerId,
              requestKeyHash: hashedRequestKey,
              canonical: parsed.parsed.canonical,
              conversationId: existingConversation.conversationId,
            });
            await transaction.audit.write({
              action: 'knowledge_import_duplicate_detected',
              actor: knowledgeProvenanceAuditActor(
                input.actor,
                input.auditActor,
              ),
              targetTable: 'knowledge_imports',
              targetId: bound.id,
              metadata: {
                format: bound.sourceType,
                turnCount: bound.turnCount,
                itemCount: bound.linkedItemCount,
                duplicate: true,
              },
            });
            return ok(resultFromRecord(bound, false));
          }
          const created = await transaction.imports.createImportedConversation({
            actor: input.actor,
            ledgerId,
            conversationId,
            itemIds,
            turnIds,
            requestKeyHash: hashedRequestKey,
            canonical: parsed.parsed.canonical,
            importedAt,
          });
          await transaction.audit.write({
            action: 'knowledge_conversation_imported',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_conversations',
            targetId: created.conversationId,
            metadata: {
              format: created.sourceType,
              turnCount: created.turnCount,
              itemCount: created.linkedItemCount,
              duplicate: false,
            },
          });
          await transaction.audit.write({
            action: 'knowledge_import_committed',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_imports',
            targetId: created.id,
            metadata: {
              format: created.sourceType,
              turnCount: created.turnCount,
              itemCount: created.linkedItemCount,
              duplicate: false,
            },
          });
          return ok(resultFromRecord(created, true));
        });
      } catch (error) {
        if (error instanceof KnowledgeConversationImportConflictError) {
          await auditRejected({
            actor: input.actor,
            auditActor: input.auditActor,
            importId: token.importId,
            canonical: parsed.parsed.canonical,
          });
          return failure(409, 'import_conflict', 'Import conflict');
        }
        throw error;
      }
    },
  };
}
