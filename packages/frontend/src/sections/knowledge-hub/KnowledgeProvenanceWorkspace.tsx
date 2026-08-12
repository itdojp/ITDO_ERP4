import React, { useCallback, useEffect, useState } from 'react';

import { Alert, Card, Tabs } from '../../ui';
import type { KnowledgeScope, KnowledgeSnapshot } from './knowledgeHubModel';
import { KnowledgeAnnotationPanel } from './KnowledgeAnnotationPanel';
import { KnowledgeConversationPanel } from './KnowledgeConversationPanel';
import { KnowledgeLlmPanel } from './KnowledgeLlmPanel';
import { KnowledgeSharePanel } from './KnowledgeSharePanel';
import { KnowledgeSynthesisPanel } from './KnowledgeSynthesisPanel';

type WorkspaceTab =
  'annotations' | 'conversations' | 'syntheses' | 'external-llm' | 'share';

const workspaceTabs = [
  { id: 'annotations', label: '本人annotation' },
  { id: 'conversations', label: '会話・取込' },
  { id: 'syntheses', label: 'Synthesis・結論' },
  { id: 'external-llm', label: '外部LLM対話' },
  { id: 'share', label: 'Chatへ共有' },
] as const;

function isWorkspaceTab(value: string): value is WorkspaceTab {
  return workspaceTabs.some((tab) => tab.id === value);
}

export function KnowledgeProvenanceWorkspace(props: {
  itemId: string;
  itemLabel: string;
  itemScope: KnowledgeScope;
  organizationId: string | null;
  snapshots: readonly KnowledgeSnapshot[];
  onCommitBusyChange?: (busy: boolean) => void;
}) {
  const { onCommitBusyChange } = props;
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('annotations');
  const [shareCommitBusy, setShareCommitBusy] = useState(false);
  const [llmCommitBusy, setLlmCommitBusy] = useState(false);
  const commitBusy = shareCommitBusy || llmCommitBusy;
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<WorkspaceTab>>(
    () => new Set(['annotations']),
  );

  const selectTab = (value: string) => {
    if (!isWorkspaceTab(value)) return;
    if (
      commitBusy &&
      !(
        (shareCommitBusy && value === 'share') ||
        (llmCommitBusy && value === 'external-llm')
      )
    ) {
      return;
    }
    setActiveTab(value);
    setVisitedTabs((current) => {
      if (current.has(value)) return current;
      return new Set([...current, value]);
    });
  };

  const handleShareCommitBusyChange = useCallback((busy: boolean) => {
    setShareCommitBusy(busy);
  }, []);

  const handleLlmCommitBusyChange = useCallback((busy: boolean) => {
    setLlmCommitBusy(busy);
  }, []);

  useEffect(() => {
    onCommitBusyChange?.(commitBusy);
  }, [commitBusy, onCommitBusyChange]);

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
      {commitBusy ? (
        <Alert variant="warning">
          外部処理の確定結果を保持するため、完了するまでtabとKnowledge
          itemの切り替えを停止しています。
        </Alert>
      ) : null}
      <Tabs
        className="knowledge-provenance-workspace-tabs"
        value={activeTab}
        onValueChange={selectTab}
        ariaLabel="Knowledge provenance機能"
        items={workspaceTabs.map((tab) => ({
          ...tab,
          disabled:
            commitBusy &&
            !(
              (shareCommitBusy && tab.id === 'share') ||
              (llmCommitBusy && tab.id === 'external-llm')
            ),
        }))}
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
            {activeTab === 'external-llm' ? (
              <div className="knowledge-provenance-retained-panel">
                <KnowledgeLlmPanel
                  key={props.itemId}
                  itemId={props.itemId}
                  itemScope={props.itemScope}
                  organizationId={props.organizationId}
                  onCommitBusyChange={handleLlmCommitBusyChange}
                />
              </div>
            ) : null}
            {activeTab === 'share' ? (
              <div className="knowledge-provenance-retained-panel">
                <KnowledgeSharePanel
                  key={props.itemId}
                  itemId={props.itemId}
                  itemLabel={props.itemLabel}
                  itemScope={props.itemScope}
                  snapshots={props.snapshots}
                  onCommitBusyChange={handleShareCommitBusyChange}
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
