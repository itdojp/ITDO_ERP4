import React from 'react';

export type WorkflowMetricTone = 'default' | 'success' | 'warning' | 'danger';

export type WorkflowMetric = {
  id?: string;
  label: string;
  value: React.ReactNode;
  helper?: React.ReactNode;
  tone?: WorkflowMetricTone;
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-primary, #0f172a)',
};

const headerPanelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 8,
  marginBottom: 12,
  padding: 12,
  border: '1px solid var(--color-border-default, #e2e8f0)',
  borderRadius: 12,
  background:
    'linear-gradient(135deg, var(--color-bg-base, #ffffff), var(--color-bg-subtle, #f8fafc))',
};

const descriptionStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-muted, #475569)',
  lineHeight: 1.6,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const metricGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  margin: '12px 0',
};

const metricBaseStyle: React.CSSProperties = {
  padding: 12,
  border: '1px solid var(--color-border-default, #e2e8f0)',
  borderRadius: 12,
  background: 'var(--color-bg-base, #ffffff)',
  boxShadow: 'var(--shadow-xs, 0 1px 2px rgba(15, 23, 42, 0.05))',
};

const metricLabelStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-muted, #475569)',
  fontSize: 12,
  fontWeight: 600,
};

const metricValueStyle: React.CSSProperties = {
  marginTop: 4,
  color: 'var(--color-text-primary, #0f172a)',
  fontSize: 20,
  fontWeight: 700,
  lineHeight: 1.25,
};

const metricHelperStyle: React.CSSProperties = {
  margin: '6px 0 0',
  color: 'var(--color-text-muted, #475569)',
  fontSize: 12,
  lineHeight: 1.5,
};

const toneBorder: Record<WorkflowMetricTone, string> = {
  default: 'var(--color-border-default, #e2e8f0)',
  success: 'var(--color-status-success, #16a34a)',
  warning: 'var(--color-status-warning, #f97316)',
  danger: 'var(--color-status-danger, #dc2626)',
};

const panelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  border: '1px solid var(--color-border-default, #e2e8f0)',
  borderRadius: 12,
  background: 'var(--color-bg-base, #ffffff)',
};

const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  marginBottom: 8,
};

const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-primary, #0f172a)',
};

const panelDescriptionStyle: React.CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--color-text-muted, #475569)',
  fontSize: 12,
  lineHeight: 1.5,
};

export const WorkflowPageHeader: React.FC<{
  title: string;
  description: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <>
    <h2 style={titleStyle}>{title}</h2>
    <div style={headerPanelStyle}>
      <p style={descriptionStyle}>{description}</p>
      {actions ? <div style={actionsStyle}>{actions}</div> : null}
    </div>
  </>
);

export const WorkflowMetricGrid: React.FC<{
  items: WorkflowMetric[];
  ariaLabel: string;
}> = ({ items, ariaLabel }) => (
  <section aria-label={ariaLabel} style={metricGridStyle}>
    {items.map((item, index) => {
      const tone = item.tone ?? 'default';
      return (
        <div
          key={`${item.id ?? item.label}-${index}`}
          style={{
            ...metricBaseStyle,
            borderColor: toneBorder[tone],
          }}
        >
          <p style={metricLabelStyle}>{item.label}</p>
          <div style={metricValueStyle}>{item.value}</div>
          {item.helper ? <p style={metricHelperStyle}>{item.helper}</p> : null}
        </div>
      );
    })}
  </section>
);

export const WorkflowPanel: React.FC<{
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, actions, children }) => {
  const titleId = React.useId();
  return (
    <section aria-labelledby={titleId} style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <h3 id={titleId} style={panelTitleStyle}>
            {title}
          </h3>
          {description ? (
            <div style={panelDescriptionStyle}>{description}</div>
          ) : null}
        </div>
        {actions ? <div style={actionsStyle}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
};
