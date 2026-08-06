import { knowledgeProvenanceLimits } from '../../application/knowledge/knowledgeProvenancePorts.js';

export type SynthesisAccessContext = {
  sourceMemo: Map<string, boolean>;
  versionMemo: Map<string, boolean>;
  nodes: number;
  edges: number;
  queries: number;
};

export function createSynthesisAccessContext(): SynthesisAccessContext {
  return {
    sourceMemo: new Map(),
    versionMemo: new Map(),
    nodes: 0,
    edges: 0,
    queries: 0,
  };
}

export function consumeSynthesisAccessBudget(
  context: SynthesisAccessContext,
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
    throw new Error('knowledge_synthesis_access_budget_exceeded');
  }
}
