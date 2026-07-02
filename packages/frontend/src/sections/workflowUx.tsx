import React from 'react';

export type WorkflowMetricTone = 'default' | 'success' | 'warning' | 'danger';

export type WorkflowMetric = {
  id?: string;
  label: string;
  value: React.ReactNode;
  helper?: React.ReactNode;
  tone?: WorkflowMetricTone;
};

const cssVar = (name: string, fallback: string) => `var(${name}, ${fallback})`;

/**
 * workflowUx は @itdo/design-system の CSS custom properties を優先し、
 * PoC 単体起動でも崩れない fallback を同じ場所に集約する。
 */
export const workflowUxTokens = {
  color: {
    textPrimary: cssVar('--color-text-primary', '#0f172a'),
    textMuted: cssVar('--color-text-muted', '#475569'),
    bgBase: cssVar('--color-bg-base', '#ffffff'),
    bgSubtle: cssVar('--color-bg-subtle', '#f8fafc'),
    borderDefault: cssVar('--color-border-default', '#e2e8f0'),
    statusSuccess: cssVar('--color-status-success', '#16a34a'),
    statusWarning: cssVar('--color-status-warning', '#f97316'),
    statusDanger: cssVar('--color-status-danger', '#dc2626'),
  },
  space: {
    xs: cssVar('--space-4', '4px'),
    sm: cssVar('--space-8', '8px'),
    md: cssVar('--space-12', '12px'),
  },
  radius: {
    panel: cssVar('--radius-lg', '12px'),
  },
  shadow: {
    metric: cssVar('--shadow-xs', '0 1px 2px rgba(15, 23, 42, 0.05)'),
  },
  typography: {
    bodyLineHeight: cssVar('--line-height-relaxed', '1.6'),
    detailLineHeight: cssVar('--line-height-normal', '1.5'),
    metricLabelSize: cssVar('--font-size-xs', '12px'),
    metricValueSize: cssVar('--font-size-xl', '20px'),
  },
} as const;

const border = (color: string) => `1px solid ${color}`;

const titleStyle: React.CSSProperties = {
  margin: 0,
  color: workflowUxTokens.color.textPrimary,
};

const headerPanelStyle: React.CSSProperties = {
  display: 'grid',
  gap: workflowUxTokens.space.sm,
  marginTop: workflowUxTokens.space.sm,
  marginBottom: workflowUxTokens.space.md,
  padding: workflowUxTokens.space.md,
  border: border(workflowUxTokens.color.borderDefault),
  borderRadius: workflowUxTokens.radius.panel,
  background: `linear-gradient(135deg, ${workflowUxTokens.color.bgBase}, ${workflowUxTokens.color.bgSubtle})`,
};

const descriptionStyle: React.CSSProperties = {
  margin: 0,
  color: workflowUxTokens.color.textMuted,
  lineHeight: workflowUxTokens.typography.bodyLineHeight,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: workflowUxTokens.space.sm,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const metricGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: workflowUxTokens.space.md,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  margin: `${workflowUxTokens.space.md} 0`,
};

const metricBaseStyle: React.CSSProperties = {
  padding: workflowUxTokens.space.md,
  border: border(workflowUxTokens.color.borderDefault),
  borderRadius: workflowUxTokens.radius.panel,
  background: workflowUxTokens.color.bgBase,
  boxShadow: workflowUxTokens.shadow.metric,
};

const metricLabelStyle: React.CSSProperties = {
  margin: 0,
  color: workflowUxTokens.color.textMuted,
  fontSize: workflowUxTokens.typography.metricLabelSize,
  fontWeight: 600,
};

const metricValueStyle: React.CSSProperties = {
  marginTop: workflowUxTokens.space.xs,
  marginLeft: 0,
  color: workflowUxTokens.color.textPrimary,
  fontSize: workflowUxTokens.typography.metricValueSize,
  fontWeight: 700,
  lineHeight: 1.25,
};

const metricHelperStyle: React.CSSProperties = {
  margin: `${workflowUxTokens.space.sm} 0 0`,
  marginLeft: 0,
  color: workflowUxTokens.color.textMuted,
  fontSize: workflowUxTokens.typography.metricLabelSize,
  lineHeight: workflowUxTokens.typography.detailLineHeight,
};

const toneBorder: Record<WorkflowMetricTone, string> = {
  default: workflowUxTokens.color.borderDefault,
  success: workflowUxTokens.color.statusSuccess,
  warning: workflowUxTokens.color.statusWarning,
  danger: workflowUxTokens.color.statusDanger,
};

const panelStyle: React.CSSProperties = {
  marginTop: workflowUxTokens.space.md,
  padding: workflowUxTokens.space.md,
  border: border(workflowUxTokens.color.borderDefault),
  borderRadius: workflowUxTokens.radius.panel,
  background: workflowUxTokens.color.bgBase,
};

const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: workflowUxTokens.space.md,
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  marginBottom: workflowUxTokens.space.sm,
};

const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  color: workflowUxTokens.color.textPrimary,
};

const panelDescriptionStyle: React.CSSProperties = {
  margin: `${workflowUxTokens.space.xs} 0 0`,
  color: workflowUxTokens.color.textMuted,
  fontSize: workflowUxTokens.typography.metricLabelSize,
  lineHeight: workflowUxTokens.typography.detailLineHeight,
};

export const WorkflowPageHeader: React.FC<{
  title: string;
  description: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => {
  const descriptionId = React.useId();

  return (
    <>
      <h2 aria-describedby={descriptionId} style={titleStyle}>
        {title}
      </h2>
      <div style={headerPanelStyle}>
        <p id={descriptionId} style={descriptionStyle}>
          {description}
        </p>
        {actions ? <div style={actionsStyle}>{actions}</div> : null}
      </div>
    </>
  );
};

export const WorkflowMetricGrid: React.FC<{
  items: WorkflowMetric[];
  ariaLabel: string;
}> = ({ items, ariaLabel }) => {
  return (
    <section aria-label={ariaLabel} style={metricGridStyle}>
      {items.map((item, index) => {
        const tone = item.tone ?? 'default';

        return (
          <dl
            key={`${item.id ?? item.label}-${index}`}
            style={{
              ...metricBaseStyle,
              borderColor: toneBorder[tone],
            }}
          >
            <dt style={metricLabelStyle}>{item.label}</dt>
            <dd style={metricValueStyle}>{item.value}</dd>
            {item.helper ? (
              <dd style={metricHelperStyle}>{item.helper}</dd>
            ) : null}
          </dl>
        );
      })}
    </section>
  );
};

export const WorkflowPanel: React.FC<{
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, actions, children }) => {
  const titleId = React.useId();
  const descriptionId = React.useId();
  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      style={panelStyle}
    >
      <div style={panelHeaderStyle}>
        <div>
          <h3 id={titleId} style={panelTitleStyle}>
            {title}
          </h3>
          {description ? (
            <div id={descriptionId} style={panelDescriptionStyle}>
              {description}
            </div>
          ) : null}
        </div>
        {actions ? <div style={actionsStyle}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
};
