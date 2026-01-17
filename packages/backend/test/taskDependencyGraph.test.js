import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTaskDependency,
  buildTaskDependencyGraph,
  hasTaskDependencyPath,
  normalizeParentId,
  removeTaskDependency,
} from '../dist/services/taskDependencyGraph.js';

test('task dependency graph: reachability', () => {
  const graph = buildTaskDependencyGraph([
    { fromTaskId: 'a', toTaskId: 'b' },
    { fromTaskId: 'b', toTaskId: 'c' },
  ]);
  assert.equal(hasTaskDependencyPath(graph, 'a', 'c'), true);
  assert.equal(hasTaskDependencyPath(graph, 'c', 'a'), false);
});

test('task dependency graph: add/remove edges', () => {
  const graph = buildTaskDependencyGraph([]);
  assert.equal(hasTaskDependencyPath(graph, 'a', 'b'), false);

  addTaskDependency(graph, 'a', 'b');
  assert.equal(hasTaskDependencyPath(graph, 'a', 'b'), true);
  assert.equal(hasTaskDependencyPath(graph, 'b', 'a'), false);

  removeTaskDependency(graph, 'a', 'b');
  assert.equal(hasTaskDependencyPath(graph, 'a', 'b'), false);
});

test('normalizeParentId: trims and converts to null', () => {
  assert.equal(normalizeParentId(undefined), null);
  assert.equal(normalizeParentId(null), null);
  assert.equal(normalizeParentId(''), null);
  assert.equal(normalizeParentId('   '), null);
  assert.equal(normalizeParentId(' x '), 'x');
});

