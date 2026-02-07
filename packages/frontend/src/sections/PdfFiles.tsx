import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import {
  Alert,
  AsyncStatePanel,
  Button,
  Card,
  CrudList,
  DataTable,
  FilterBar,
  Input,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';
import { openResponseInNewTab } from '../utils/download';

type PdfFileItem = {
  filename: string;
  size: number;
  modifiedAt: string;
};

type PdfFileListResponse = {
  items: PdfFileItem[];
  total: number;
  limit: number;
  offset: number;
};

type ListStatus = 'idle' | 'loading' | 'error' | 'success';

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return '-';
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

export const PdfFiles: React.FC = () => {
  const [prefix, setPrefix] = useState('');
  const [items, setItems] = useState<PdfFileItem[]>([]);
  const [meta, setMeta] = useState<PdfFileListResponse | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [listStatus, setListStatus] = useState<ListStatus>('idle');
  const [listError, setListError] = useState('');
  const [openBusy, setOpenBusy] = useState<Record<string, boolean>>({});

  const queryPrefix = prefix.trim();

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (queryPrefix) params.set('prefix', queryPrefix);
    return `/pdf-files?${params.toString()}`;
  }, [queryPrefix]);

  const loadFiles = useCallback(async () => {
    try {
      setListStatus('loading');
      setListError('');
      setMessage(null);
      const res = await api<PdfFileListResponse>(listUrl);
      setItems(res.items || []);
      setMeta(res);
      setListStatus('success');
    } catch (err) {
      console.error('Failed to load pdf files.', err);
      setItems([]);
      setMeta(null);
      setListStatus('error');
      setListError('PDF一覧の取得に失敗しました');
    }
  }, [listUrl]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const openPdf = useCallback(async (filename: string) => {
    try {
      setOpenBusy((prev) => ({ ...prev, [filename]: true }));
      setMessage(null);
      const res = await apiResponse(
        `/pdf-files/${encodeURIComponent(filename)}`,
      );
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      await openResponseInNewTab(res, filename);
    } catch (err) {
      console.error('Failed to open pdf file.', err);
      setMessage({ text: 'PDFの取得に失敗しました', type: 'error' });
    } finally {
      setOpenBusy((prev) => ({ ...prev, [filename]: false }));
    }
  }, []);

  const rows = useMemo<DataTableRow[]>(
    () =>
      items.map((item) => ({
        id: item.filename,
        filename: item.filename,
        size: formatBytes(item.size),
        modifiedAt: formatDateTime(item.modifiedAt),
      })),
    [items],
  );

  const columns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'filename', header: 'ファイル名' },
      { key: 'size', header: 'サイズ' },
      { key: 'modifiedAt', header: '更新日時' },
      {
        key: 'open',
        header: '',
        cell: (row) => {
          const filename = String(row.filename || '');
          return (
            <Button
              variant="secondary"
              onClick={() => {
                if (!filename) return;
                if (openBusy[filename]) return;
                void openPdf(filename);
              }}
              loading={Boolean(openBusy[filename])}
            >
              開く
            </Button>
          );
        },
      },
    ],
    [openBusy, openPdf],
  );

  const table = (() => {
    if (listStatus === 'idle' || listStatus === 'loading') {
      return <AsyncStatePanel state="loading" loadingText="PDF一覧を取得中" />;
    }
    if (listStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: 'PDF一覧の取得に失敗しました',
            detail: listError,
            onRetry: () => {
              void loadFiles();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: 'PDFファイルがありません',
            description: '検索条件を変更して再試行してください',
          }}
        />
      );
    }
    return <DataTable columns={columns} rows={rows} />;
  })();

  return (
    <div>
      <h2>PDFファイル一覧</h2>
      <Card padding="small">
        <CrudList
          title="ファイル検索"
          description="ファイル名プレフィックスで絞り込んでPDFを開きます。"
          filters={
            <FilterBar
              actions={
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPrefix('');
                    }}
                  >
                    条件クリア
                  </Button>
                  <Button
                    onClick={loadFiles}
                    loading={listStatus === 'loading'}
                  >
                    再読込
                  </Button>
                </div>
              }
            >
              <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
                <Input
                  label="filename prefix"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="例: invoice-"
                />
              </div>
            </FilterBar>
          }
          table={
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ color: '#6b7280' }}>
                {meta
                  ? `件数: ${meta.total}件（表示: ${meta.limit}件）`
                  : '件数: -'}
              </div>
              {table}
            </div>
          }
        />
        {message && (
          <div style={{ marginTop: 8 }}>
            <Alert variant={message.type === 'error' ? 'error' : 'info'}>
              {message.text}
            </Alert>
          </div>
        )}
      </Card>
    </div>
  );
};
