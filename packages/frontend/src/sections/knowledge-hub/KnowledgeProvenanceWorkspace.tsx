import React, { useState } from 'react';

import { Alert, Card, Tabs } from '../../ui';
import type { KnowledgeScope } from './knowledgeHubModel';
import { KnowledgeAnnotationPanel } from './KnowledgeAnnotationPanel';
import { KnowledgeConversationPanel } from './KnowledgeConversationPanel';
import { KnowledgeSynthesisPanel } from './KnowledgeSynthesisPanel';

type WorkspaceTab = 'annotations' | 'conversations' | 'syntheses';

const workspaceTabs = [
  { id: 'annotations', label: '本人annotation' },
  { id: 'conversations', label: '会話・取込' },
  { id: 'syntheses', label: 'Synthesis・結論' },
] as const;

function isWorkspaceTab(value: string): value is WorkspaceTab {
  return workspaceTabs.some((tab) => tab.id === value);
}

export function KnowledgeProvenanceWorkspace(props: {
  itemId: string;
  itemLabel: string;
  itemScope: KnowledgeScope;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('annotations');
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<WorkspaceTab>>(
    () => new Set(['annotations']),
  );

  const selectTab = (value: string) => {
    if (!isWorkspaceTab(value)) return;
    setActiveTab(value);
    setVisitedTabs((current) => {
      if (current.has(value)) return current;
      return new Set([...current, value]);
    });
  };

  return (
    <Card className="knowledge-provenance-workspace" padding="small">
      <div className="knowledge-provenance-workspace-heading">
        <div>
          <strong>{props.itemLabel}</strong>
          <span>
            {props.itemScope === 'personal' ? '個人scope' : '組織scope'} /
            current ACLをserver側で再検査
          </span>
        </div>
      </div>
      <Alert variant="info">
        元snapshot、本人annotation、会話turn、Synthesisは別entityとして履歴を保持します。
        外部情報・引用・本人意見・AI・System・Tool・結論をlabelでも区別します。
      </Alert>
      <Tabs
        className="knowledge-provenance-workspace-tabs"
        value={activeTab}
        onValueChange={selectTab}
        ariaLabel="Knowledge provenance機能"
        items={workspaceTabs.map((tab) => ({ ...tab }))}
        renderPanel={() => (
          <div className="knowledge-provenance-retained-panels">
            {visitedTabs.has('annotations') ? (
              <div
                className="knowledge-provenance-retained-panel"
                hidden={activeTab !== 'annotations'}
              >
                <KnowledgeAnnotationPanel
                  itemId={props.itemId}
                  itemScope={props.itemScope}
                />
              </div>
            ) : null}
            {visitedTabs.has('conversations') ? (
              <div
                className="knowledge-provenance-retained-panel"
                hidden={activeTab !== 'conversations'}
              >
                <KnowledgeConversationPanel itemId={props.itemId} />
              </div>
            ) : null}
            {visitedTabs.has('syntheses') ? (
              <div
                className="knowledge-provenance-retained-panel"
                hidden={activeTab !== 'syntheses'}
              >
                <KnowledgeSynthesisPanel
                  itemId={props.itemId}
                  itemScope={props.itemScope}
                />
              </div>
            ) : null}
          </div>
        )}
        fullWidth
        panelClassName="knowledge-provenance-workspace-panel"
      />
    </Card>
  );
}
