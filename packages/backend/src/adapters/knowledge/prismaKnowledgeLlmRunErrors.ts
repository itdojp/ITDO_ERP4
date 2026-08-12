export class KnowledgeLlmProviderOutcomeMissingError extends Error {
  readonly name = 'KnowledgeLlmProviderOutcomeMissingError';
  constructor() {
    super('knowledge_llm_outcome_missing');
  }
}
