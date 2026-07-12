export type TaskDependencyEdge = { fromTaskId: string; toTaskId: string };
export type TaskParentNode = { id: string; parentTaskId: string | null };

export function buildTaskDependencyGraph(edges: TaskDependencyEdge[]) {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const next = graph.get(edge.fromTaskId) ?? new Set<string>();
    next.add(edge.toTaskId);
    graph.set(edge.fromTaskId, next);
  }
  return graph;
}

export function removeTaskDependency(
  graph: Map<string, Set<string>>,
  fromTaskId: string,
  toTaskId: string,
) {
  const next = graph.get(fromTaskId);
  if (!next) return;
  next.delete(toTaskId);
  if (next.size === 0) {
    graph.delete(fromTaskId);
  }
}

export function addTaskDependency(
  graph: Map<string, Set<string>>,
  fromTaskId: string,
  toTaskId: string,
) {
  const next = graph.get(fromTaskId) ?? new Set<string>();
  next.add(toTaskId);
  graph.set(fromTaskId, next);
}

export function hasTaskDependencyPath(
  graph: Map<string, Set<string>>,
  startId: string,
  targetId: string,
) {
  if (startId === targetId) return true;
  const visited = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const next = graph.get(current);
    if (!next) continue;
    for (const neighbor of next) {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    }
  }
  return false;
}

export function normalizeParentId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildTaskParentMap(nodes: TaskParentNode[]) {
  const parents = new Map<string, string | null>();
  for (const node of nodes) {
    parents.set(node.id, node.parentTaskId);
  }
  return parents;
}

export function hasTaskParentCycle(
  parentByTaskId: Map<string, string | null>,
  taskId: string,
  parentTaskId: string | null,
) {
  const visited = new Set<string>([taskId]);
  let currentId = parentTaskId;
  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    if (!parentByTaskId.has(currentId)) return false;
    currentId = parentByTaskId.get(currentId) ?? null;
  }
  return false;
}
