import React, {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { navigateToOpen } from '../../utils/deepLink';
import { openKnowledgeShareSource } from '../knowledge-share/knowledgeShareApi';
import type {
  KnowledgeShareCard as KnowledgeShareCardValue,
  KnowledgeShareRoomCard,
  KnowledgeShareSourceType,
} from '../knowledge-share/knowledgeShareModel';

const sourceTypeLabels: Record<KnowledgeShareSourceType, string> = {
  x: 'X',
  threads: 'Threads',
  news: 'ニュース',
  web: 'Web',
  pdf: 'PDF',
  image: '画像',
  manual: '手動登録',
  other: 'その他',
};

const annotationKindLabels: Record<
  KnowledgeShareCardValue['annotations'][number]['kind'],
  string
> = {
  note: 'メモ',
  question: '質問',
  hypothesis: '仮説',
  quote: '引用',
  todo: '対応事項',
};

const originLabels: Record<
  KnowledgeShareCardValue['annotations'][number]['origin'],
  string
> = {
  user: '利用者',
  external: '外部情報',
  ai: 'AI',
  system: 'システム',
  tool: 'ツール',
};

const roleLabels: Record<
  KnowledgeShareCardValue['turns'][number]['role'],
  string
> = {
  user: '利用者',
  assistant: 'アシスタント',
  system: 'システム',
  tool: 'ツール',
};

const valueStyle = {
  margin: '4px 0 0',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
} as const;

function SelectedField(props: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt style={{ color: '#475569', fontSize: 12, fontWeight: 600 }}>
        {props.label}
      </dt>
      <dd style={valueStyle}>{props.children}</dd>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function KnowledgeShareSelectedContent({
  card,
}: {
  card: KnowledgeShareCardValue;
}) {
  const contentId = useId();
  const selected = new Set(card.selectedCategories);
  const snapshotHasProvenance =
    selected.has('snapshot_provenance') &&
    card.snapshot?.version !== undefined &&
    card.snapshot.sha256 !== undefined;
  const snapshotHasExcerpt =
    selected.has('snapshot_excerpt') && card.snapshot?.excerpt !== undefined;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <dl
        style={{
          display: 'grid',
          gap: 12,
          margin: 0,
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
        }}
      >
        {selected.has('title') && card.title !== null ? (
          <SelectedField label="タイトル">{card.title}</SelectedField>
        ) : null}
        {selected.has('source_type') && card.sourceType !== null ? (
          <SelectedField label="情報源の種類">
            {sourceTypeLabels[card.sourceType]}
          </SelectedField>
        ) : null}
        {selected.has('canonical_url') && card.canonicalUrl !== null ? (
          <SelectedField label="共有URL">{card.canonicalUrl}</SelectedField>
        ) : null}
        {snapshotHasProvenance ? (
          <>
            <SelectedField label="スナップショット版">
              {card.snapshot?.version}
            </SelectedField>
            <SelectedField label="スナップショットSHA-256">
              <code>{card.snapshot?.sha256}</code>
            </SelectedField>
          </>
        ) : null}
        {snapshotHasExcerpt ? (
          <SelectedField label="抜粋">{card.snapshot?.excerpt}</SelectedField>
        ) : null}
        {selected.has('sharer_note') && card.sharerNote !== null ? (
          <SelectedField label="共有者メモ">{card.sharerNote}</SelectedField>
        ) : null}
      </dl>

      {selected.has('label') && card.labels.length > 0 ? (
        <section aria-labelledby={`${contentId}-labels`}>
          <h4 id={`${contentId}-labels`} style={{ margin: 0 }}>
            ラベル
          </h4>
          <ul style={{ marginBottom: 0, paddingInlineStart: 24 }}>
            {card.labels.map((label, index) => (
              <li key={`${label.displayName}-${index}`}>{label.displayName}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected.has('annotation') && card.annotations.length > 0 ? (
        <section aria-labelledby={`${contentId}-annotations`}>
          <h4 id={`${contentId}-annotations`} style={{ margin: 0 }}>
            注釈
          </h4>
          <ol style={{ display: 'grid', gap: 10, paddingInlineStart: 24 }}>
            {card.annotations.map((annotation, index) => (
              <li key={`${annotation.revision}-${index}`}>
                <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
                  <SelectedField label="種類">
                    {annotationKindLabels[annotation.kind]}
                  </SelectedField>
                  <SelectedField label="作成元">
                    {originLabels[annotation.origin]}
                  </SelectedField>
                  <SelectedField label="版">
                    {annotation.revision}
                  </SelectedField>
                  <SelectedField label="内容">
                    {annotation.content}
                  </SelectedField>
                </dl>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {selected.has('conversation_turn') && card.turns.length > 0 ? (
        <section aria-labelledby={`${contentId}-turns`}>
          <h4 id={`${contentId}-turns`} style={{ margin: 0 }}>
            会話ターン
          </h4>
          <ol style={{ display: 'grid', gap: 10, paddingInlineStart: 24 }}>
            {card.turns.map((turn, index) => {
              const occurredAt = formatDateTime(turn.occurredAt);
              return (
                <li key={`${turn.role}-${index}`}>
                  <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
                    <SelectedField label="役割">
                      {roleLabels[turn.role]}
                    </SelectedField>
                    <SelectedField label="作成元">
                      {originLabels[turn.origin]}
                    </SelectedField>
                    {turn.name !== null ? (
                      <SelectedField label="名前">{turn.name}</SelectedField>
                    ) : null}
                    {occurredAt ? (
                      <SelectedField label="発生日時">
                        {occurredAt}
                      </SelectedField>
                    ) : null}
                    <SelectedField label="内容">{turn.content}</SelectedField>
                  </dl>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {selected.has('synthesis') && card.syntheses.length > 0 ? (
        <section aria-labelledby={`${contentId}-syntheses`}>
          <h4 id={`${contentId}-syntheses`} style={{ margin: 0 }}>
            統合知
          </h4>
          <ol style={{ display: 'grid', gap: 10, paddingInlineStart: 24 }}>
            {card.syntheses.map((synthesis, index) => (
              <li key={`${synthesis.version}-${index}`}>
                <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
                  <SelectedField label="タイトル">
                    {synthesis.title}
                  </SelectedField>
                  <SelectedField label="版">{synthesis.version}</SelectedField>
                  <SelectedField label="内容">
                    {synthesis.content}
                  </SelectedField>
                  <SelectedField label="信頼度">
                    {synthesis.confidenceBasisPoints !== null
                      ? `${(synthesis.confidenceBasisPoints / 100).toFixed(2)}%`
                      : '未設定'}
                  </SelectedField>
                  <SelectedField label="未解決の質問">
                    {synthesis.unresolvedQuestions.length > 0 ? (
                      <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                        {synthesis.unresolvedQuestions.map(
                          (question, questionIndex) => (
                            <li key={`${question}-${questionIndex}`}>
                              {question}
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      'なし'
                    )}
                  </SelectedField>
                </dl>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

export function KnowledgeShareCard(
  props:
    | {
        knowledgeShare: KnowledgeShareRoomCard;
        share?: never;
        sharedAt?: string | null;
      }
    | {
        share: KnowledgeShareRoomCard;
        knowledgeShare?: never;
        sharedAt?: string | null;
      },
) {
  const knowledgeShare = props.knowledgeShare ?? props.share;
  const headingId = useId();
  const noticeId = useId();
  const identity = `${knowledgeShare.shareId}\u0000${knowledgeShare.version}\u0000${knowledgeShare.status}\u0000${knowledgeShare.canOpenSource}`;
  const [openingIdentity, setOpeningIdentity] = useState('');
  const [notice, setNotice] = useState<{
    identity: string;
    text: string;
  } | null>(null);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setOpeningIdentity('');
    setNotice(null);
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [identity]);

  const openSource = async () => {
    if (
      knowledgeShare.status !== 'posted' ||
      !knowledgeShare.canOpenSource ||
      openingIdentity === identity
    ) {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setOpeningIdentity(identity);
    setNotice(null);
    try {
      const source = await openKnowledgeShareSource(knowledgeShare.shareId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || generationRef.current !== generation) {
        return;
      }
      navigateToOpen({ kind: 'knowledge_item', id: source.knowledgeItemId });
    } catch {
      if (controller.signal.aborted || generationRef.current !== generation) {
        return;
      }
      setNotice({
        identity,
        text: '元のナレッジを開けませんでした。権限を確認してください。',
      });
    } finally {
      if (generationRef.current === generation) setOpeningIdentity('');
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  if (knowledgeShare.status === 'revoked') {
    return (
      <article
        className="card"
        aria-label="共有されたナレッジ"
        style={{ padding: 12 }}
      >
        <p role="status" style={{ margin: 0, color: '#64748b' }}>
          このナレッジ共有は取り消されました。共有内容は表示されません。
        </p>
      </article>
    );
  }

  if (!knowledgeShare.card) {
    return (
      <article
        className="card"
        aria-label="共有されたナレッジ"
        style={{ padding: 12 }}
      >
        <p role="status" style={{ margin: 0, color: '#64748b' }}>
          共有内容を表示できません。
        </p>
      </article>
    );
  }

  return (
    <article
      className="card knowledge-share-card"
      aria-labelledby={headingId}
      style={{ padding: 'clamp(12px, 3vw, 18px)', overflow: 'hidden' }}
    >
      <div
        className="row"
        style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
      >
        <h3 id={headingId} style={{ margin: 0 }}>
          共有されたナレッジ
        </h3>
        {knowledgeShare.canOpenSource ? (
          <button
            type="button"
            className="button secondary"
            disabled={openingIdentity === identity}
            aria-describedby={
              notice?.identity === identity ? noticeId : undefined
            }
            onClick={() => void openSource()}
            style={{ minHeight: 44 }}
          >
            {openingIdentity === identity ? '確認中...' : '元のナレッジを開く'}
          </button>
        ) : null}
      </div>
      {props.sharedAt && formatDateTime(props.sharedAt) ? (
        <p style={{ marginBottom: 0 }}>
          共有日時:{' '}
          <time dateTime={props.sharedAt}>
            {formatDateTime(props.sharedAt)}
          </time>
        </p>
      ) : null}
      <div style={{ marginTop: 14 }}>
        <KnowledgeShareSelectedContent card={knowledgeShare.card} />
      </div>
      {notice?.identity === identity ? (
        <p
          id={noticeId}
          role="status"
          style={{ color: '#b91c1c', marginBottom: 0 }}
        >
          {notice.text}
        </p>
      ) : null}
    </article>
  );
}

export function KnowledgeShareCardLoading() {
  return (
    <article
      className="card knowledge-share-card knowledge-share-card-loading"
      aria-label="共有されたナレッジ"
      aria-busy="true"
      style={{ padding: 'clamp(12px, 3vw, 18px)', overflow: 'hidden' }}
    >
      <p role="status" style={{ margin: 0 }}>
        知識共有を読み込み中...
      </p>
    </article>
  );
}
