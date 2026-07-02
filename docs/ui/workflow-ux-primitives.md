# workflowUx primitives and token policy

## Purpose

`packages/frontend/src/sections/workflowUx.tsx` provides small cross-screen primitives used by the ERP4 PoC workflow screens after the all-screen UX/UI baseline.

These primitives are intentionally narrower than `@itdo/design-system`:

- use the design-system CSS custom properties first;
- keep ERP4 workflow-specific layout and a11y contracts close to screen code;
- avoid changing the external design-system package from this repository;
- provide stable contracts for E2E and component tests.

## Primitive responsibilities

| Primitive            | Responsibility                                                    | Heading / landmark contract                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkflowPageHeader` | Page-level workflow title, purpose, and optional actions.         | Renders a level-2 heading and links that heading to its guidance text with `aria-describedby` while preserving the established sibling DOM contract used by phase E2E specs. |
| `WorkflowMetricGrid` | Compact summary metrics that support quick next-action decisions. | Renders a named `section`; each metric uses `dl` / `dt` / `dd` so label/value/helper are semantic and not color-only.                                                        |
| `WorkflowPanel`      | Groups a workflow step, list, form, or decision panel.            | Renders a named `section` via `aria-labelledby`; when description exists it is linked with `aria-describedby`.                                                               |
| Shared action layout | Keeps local action buttons visually grouped.                      | Actions remain ordinary buttons/links supplied by the caller; the primitive does not hide or relabel them.                                                                   |

## Token policy

`workflowUxTokens` is the local token bridge. Values must use `@itdo/design-system` CSS custom properties with explicit fallbacks so screens remain usable in local PoC and test environments.

| Area       | Source preference                        | Current examples                                         |
| ---------- | ---------------------------------------- | -------------------------------------------------------- |
| Color      | `--color-*` semantic design-system vars  | `--color-text-primary`, `--color-bg-base`, status colors |
| Spacing    | `--space-*` design-system vars           | `--space-4`, `--space-8`, `--space-12`                   |
| Radius     | `--radius-*` design-system vars          | `--radius-lg`                                            |
| Shadow     | `--shadow-*` design-system vars          | `--shadow-xs`                                            |
| Typography | `--font-size-*` / `--line-height-*` vars | metric label/value sizes and guidance line-height        |

Rules:

1. Add new workflow styles through `workflowUxTokens` or a helper built from it.
2. Do not introduce screen-local fallback colors, spacing, radius, or shadows when an equivalent token exists.
3. If a required token does not exist in the design-system package, use an explicit fallback and document the intended upstream token in this file or the PR body.
4. Avoid color-only state. A tone may change a border color, but the metric label/value/helper text must still communicate meaning.
5. Keep primitive props focused on workflow semantics. Do not turn `workflowUx` into a generic design-system replacement.

## Usage pattern

```tsx
<WorkflowPageHeader
  title="請求"
  description="請求作成、検索、送信、入金状態を同じ文脈で確認します。"
/>

<WorkflowMetricGrid
  ariaLabel="請求判断サマリー"
  items={[
    { id: 'visible', label: '表示中の請求', value: '12件', helper: '全体 20件' },
    { id: 'payment', label: '入金状況', value: '未入金 3件', tone: 'warning' },
  ]}
/>

<WorkflowPanel title="請求作成" description="金額または工数集計から請求ドラフトを作成します。">
  {/* form controls with labels */}
</WorkflowPanel>
```

## Review checklist

- `WorkflowPageHeader` remains one level-2 heading per workflow screen.
- `WorkflowMetricGrid` has a screen-specific `ariaLabel`; metric labels are not duplicated as form labels in a way that breaks `getByLabel` queries.
- `WorkflowPanel` titles are unique enough for `getByRole('region', { name })`.
- Input controls inside panels use real labels or `aria-label`; placeholder-only labels are not allowed.
- New visual state uses text plus tokenized color, not color alone.
- Representative component or Playwright tests cover any new primitive contract.

## Follow-up boundaries

- Visual screenshot diff automation belongs to #1850.
- Bundle splitting and lazy loading belong to #1849.
- Upstream design-system package API additions, such as replacing the #1847 command-palette input-label bridge with an official prop, should be planned separately before changing the external package contract.
