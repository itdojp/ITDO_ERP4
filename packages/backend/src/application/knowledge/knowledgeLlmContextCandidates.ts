import type { KnowledgeActor } from './knowledgeItemPorts.js';
import { knowledgeItemScopes } from './knowledgeItemPorts.js';
import {
  knowledgeLlmContextSourceTypes,
  type KnowledgeLlmContextSourceType,
} from './knowledgeLlmContext.js';
import type { KnowledgeLlmContextCandidatePort } from './knowledgeLlmRunPorts.js';
import type { KnowledgePageBoundary } from './knowledgeProvenancePorts.js';
import {
  hasKnowledgePrincipal,
  isAllowedKnowledgeValue,
  isBoundedKnowledgeId,
  isValidKnowledgeListLimit,
  provenanceNotFound,
  provenanceOk,
} from './knowledgeProvenanceValidation.js';

export function createKnowledgeLlmContextCandidateService(dependencies: {
  candidates: KnowledgeLlmContextCandidatePort;
}) {
  return {
    async list(input: {
      actor: KnowledgeActor;
      itemId: string;
      scope: 'personal' | 'organization';
      organizationId: string | null;
      sourceType: KnowledgeLlmContextSourceType;
      limit: number;
      boundary?: KnowledgePageBoundary;
    }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.itemId) ||
        !isAllowedKnowledgeValue(knowledgeItemScopes, input.scope) ||
        !isAllowedKnowledgeValue(
          knowledgeLlmContextSourceTypes,
          input.sourceType,
        ) ||
        !isValidKnowledgeListLimit(input.limit) ||
        (input.scope === 'personal'
          ? input.organizationId !== null
          : !input.organizationId ||
            input.organizationId !== input.actor.organizationId)
      ) {
        return provenanceNotFound();
      }
      const page = await dependencies.candidates.list(input);
      return page ? provenanceOk(page) : provenanceNotFound();
    },
  };
}

export type KnowledgeLlmContextCandidateService = ReturnType<
  typeof createKnowledgeLlmContextCandidateService
>;
