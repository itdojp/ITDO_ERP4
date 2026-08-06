import { knowledgeProvenanceLimits } from './knowledgeProvenancePorts.js';

export type KnowledgeSynthesisAccessContext = {
  sourceMemo: Map<string, boolean>;
  versionMemo: Map<string, boolean>;
  nodes: number;
  edges: number;
  queries: number;
};

export function createSynthesisAccessContext(): KnowledgeSynthesisAccessContext {
  return {
    sourceMemo: new Map(),
    versionMemo: new Map(),
    nodes: 0,
    edges: 0,
    queries: 0,
  };
}

export class KnowledgeSynthesisAccessBudgetError extends Error {
  constructor() {
    super('knowledge_synthesis_access_budget_exceeded');
    this.name = 'KnowledgeSynthesisAccessBudgetError';
  }
}

export function consumeSynthesisAccessBudget(
  context: KnowledgeSynthesisAccessContext,
  kind: 'node' | 'edge' | 'query',
) {
  const counter =
    kind === 'node' ? 'nodes' : kind === 'edge' ? 'edges' : 'queries';
  context[counter] += 1;
  const limit =
    kind === 'node'
      ? knowledgeProvenanceLimits.synthesisProvenanceNodes
      : kind === 'edge'
        ? knowledgeProvenanceLimits.synthesisProvenanceEdges
        : knowledgeProvenanceLimits.synthesisProvenanceQueries;
  if (context[counter] > limit) {
    throw new KnowledgeSynthesisAccessBudgetError();
  }
}
