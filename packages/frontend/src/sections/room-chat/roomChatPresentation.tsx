import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { copyToClipboard } from '../../utils/clipboard';
import { buildOpenHash } from '../../utils/deepLink';
import {
  buildExcerpt,
  escapeMarkdownLinkLabel,
  formatRoomLabel,
  markdownAllowedElements,
  transformLinkUri,
  type ChatMessage,
  type ChatRoom,
} from './roomChatModel';

export function renderRoomChatMessageBody(text: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      allowedElements={markdownAllowedElements}
      urlTransform={transformLinkUri}
    >
      {text}
    </ReactMarkdown>
  );
}

export async function copyRoomChatMessageLink(input: {
  mode: 'url' | 'markdown';
  item: Pick<ChatMessage, 'id' | 'createdAt' | 'userId' | 'body'>;
  room: ChatRoom | null | undefined;
  roomId: string;
  currentUserId: string;
  onMessage: (message: string) => void;
}) {
  const hash = buildOpenHash({ kind: 'chat_message', id: input.item.id });
  const url = `/${hash}`;
  if (input.mode === 'url') {
    const ok = await copyToClipboard(url);
    input.onMessage(ok ? 'リンクURLをコピーしました' : 'コピーに失敗しました');
    return;
  }
  const roomLabel = input.room
    ? formatRoomLabel(input.room, input.currentUserId)
    : input.roomId;
  const label = escapeMarkdownLinkLabel(
    `${roomLabel} ${new Date(input.item.createdAt).toLocaleString()} ${input.item.userId}: ${buildExcerpt(input.item.body ?? '', 80)}`.trim(),
  );
  const ok = await copyToClipboard(`[${label}](${url})`);
  input.onMessage(
    ok ? 'Markdownリンクをコピーしました' : 'コピーに失敗しました',
  );
}

export function buildRoomChatSummaryItems(input: {
  room: ChatRoom | null | undefined;
  roomId: string;
  currentUserId: string;
  unreadCount: number;
  highlightSince: Date | null;
  displayedMessageCount: number;
  hasMore: boolean;
  ackTargetCount: number;
  globalResultCount: number;
  globalHasMore: boolean;
}) {
  const selectedRoomLabel = input.room
    ? formatRoomLabel(input.room, input.currentUserId)
    : input.roomId || '未選択';
  return [
    {
      label: '選択中ルーム',
      value: selectedRoomLabel,
      helper: input.room
        ? `${input.room.type}${input.room.isMember === false ? ' / 非参加' : ''}`
        : 'ルームを選択すると投稿・検索・通知設定を操作できます。',
      tone: input.room ? ('success' as const) : ('warning' as const),
    },
    {
      label: '未読',
      value: `${input.unreadCount}件`,
      helper: input.highlightSince
        ? `最終既読: ${input.highlightSince.toLocaleString()}`
        : '未読状態を読み込み中または未設定です。',
      tone: input.unreadCount > 0 ? ('warning' as const) : ('default' as const),
    },
    {
      label: '表示メッセージ',
      value: `${input.displayedMessageCount}件`,
      helper: input.hasMore
        ? '追加読み込み可能です。'
        : '現在の条件で読み込んだ件数です。',
    },
    {
      label: '確認対象',
      value: `${input.ackTargetCount}件`,
      helper:
        input.ackTargetCount > 0
          ? '確認依頼の対象が設定されています。'
          : '必要に応じてユーザ・グループ・ロールを指定します。',
    },
    {
      label: '横断検索結果',
      value: `${input.globalResultCount}件`,
      helper: input.globalHasMore
        ? '横断検索に続きがあります。'
        : 'チャット全体の検索結果件数です。',
    },
  ];
}

export function getRootPostLifecycleMessage(
  lifecycle: 'idle' | 'in_flight' | 'uncertain',
) {
  if (lifecycle === 'uncertain') {
    return '投稿結果を確認できません。重複防止のため再送せず、ページを再読み込みしてください';
  }
  if (lifecycle === 'in_flight') {
    return '投稿処理中です。結果が確定するまで再送しないでください';
  }
  return '';
}
