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
  return (
    <Card padding="small">
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
        onValueChange={(value) => {
          if (isWorkspaceTab(value)) setActiveTab(value);
        }}
        ariaLabel="Knowledge provenance機能"
        items={workspaceTabs.map((tab) => ({
          ...tab,
          panel:
            tab.id === 'annotations' ? (
              <KnowledgeAnnotationPanel
                itemId={props.itemId}
                itemScope={props.itemScope}
              />
            ) : tab.id === 'conversations' ? (
              <KnowledgeConversationPanel itemId={props.itemId} />
            ) : (
              <KnowledgeSynthesisPanel
                itemId={props.itemId}
                itemScope={props.itemScope}
              />
            ),
        }))}
        fullWidth
        panelClassName="knowledge-provenance-workspace-panel"
      />
    </Card>
  );
}
