// See docs/architecture/greenfield-ideal-design.md section 1.1.
// This gate treats lower-index contexts as more stable/foundational and forbids
// direct imports from those contexts to higher-level contexts. Existing
// violations are baselined in dependency-cruiser-known-violations.json so new
// violations fail CI while current hotspots are reduced incrementally.

const { contexts } = require('./bounded-context-registry.cjs');

function contextRule(fromContext, forbiddenContexts) {
  return {
    name: `bounded-context-${fromContext.name}-direction`,
    comment: `${fromContext.displayName} must not import contexts that are later in the documented dependency direction; use an application service, event, or documented adapter instead. See docs/architecture/greenfield-ideal-design.md#11-バウンデッドコンテキストモジュール分割`,
    severity: 'error',
    from: { path: fromContext.patterns },
    to: { path: forbiddenContexts.flatMap((context) => context.patterns) },
  };
}

module.exports = {
  forbidden: contexts
    .map((context, index) => contextRule(context, contexts.slice(index + 1)))
    .filter((rule) => rule.to.path.length > 0),
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|coverage|node_modules|test)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
  },
};
