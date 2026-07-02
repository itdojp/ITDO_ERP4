import type React from 'react';
import {
  buildExcerpt,
  formatRoomLabel,
  type ChatSearchItem,
} from './roomChatModel';

type AsyncVoid = void | Promise<void>;

export type RoomGlobalSearchProps = {
  globalQuery: string;
  setGlobalQuery: React.Dispatch<React.SetStateAction<string>>;
  loadGlobalSearch: (options?: { append?: boolean }) => AsyncVoid;
  globalLoading: boolean;
  setGlobalItems: React.Dispatch<React.SetStateAction<ChatSearchItem[]>>;
  setGlobalHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  setGlobalMessage: React.Dispatch<React.SetStateAction<string>>;
  globalMessage: string;
  globalItems: ChatSearchItem[];
  globalHasMore: boolean;
  openSearchResult: (item: ChatSearchItem) => void;
  currentUserId: string;
};

export function RoomGlobalSearch({
  globalQuery,
  setGlobalQuery,
  loadGlobalSearch,
  globalLoading,
  setGlobalItems,
  setGlobalHasMore,
  setGlobalMessage,
  globalMessage,
  globalItems,
  globalHasMore,
  openSearchResult,
  currentUserId,
}: RoomGlobalSearchProps) {
  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }}>
      <strong>横断検索（チャット全体）</strong>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <label>
          横断検索（本文）
          <input
            type="text"
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
            placeholder="keyword"
          />
        </label>
        <button
          className="button secondary"
          onClick={() => loadGlobalSearch()}
          disabled={globalLoading}
        >
          検索
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setGlobalQuery('');
            setGlobalItems([]);
            setGlobalHasMore(false);
            setGlobalMessage('');
          }}
          disabled={globalLoading}
        >
          クリア
        </button>
      </div>

      {globalMessage && (
        <div style={{ color: '#dc2626', marginTop: 6 }}>{globalMessage}</div>
      )}
      {globalLoading && <div style={{ marginTop: 8 }}>検索中...</div>}

      <div className="list" style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {globalItems.map((item) => {
          const createdAt = new Date(item.createdAt).toLocaleString();
          const roomLabel = formatRoomLabel(item.room, currentUserId);
          const excerpt = buildExcerpt(item.body);
          return (
            <div key={item.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{roomLabel}</strong>
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    {createdAt} / {item.userId}
                  </div>
                  {excerpt && (
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      {excerpt}
                    </div>
                  )}
                </div>
                <button
                  className="button secondary"
                  onClick={() => openSearchResult(item)}
                >
                  開く
                </button>
              </div>
            </div>
          );
        })}
        {globalItems.length === 0 && !globalLoading && (
          <div className="card" style={{ padding: 12 }}>
            検索結果なし
          </div>
        )}
      </div>

      {globalHasMore && (
        <button
          className="button secondary"
          style={{ marginTop: 12 }}
          onClick={() => loadGlobalSearch({ append: true })}
          disabled={globalLoading}
        >
          さらに読み込む
        </button>
      )}
    </div>
  );
}
