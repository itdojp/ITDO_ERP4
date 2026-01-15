import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import { Alert, Button, Card, EmptyState, Input } from '../ui';
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
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
      setIsLoading(true);
      setMessage('');
      const res = await api<PdfFileListResponse>(listUrl);
      setItems(res.items || []);
      setMeta(res);
    } catch (err) {
      console.error('Failed to load pdf files.', err);
      setItems([]);
      setMeta(null);
      setMessage('PDF一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [listUrl]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const openPdf = async (filename: string) => {
    try {
      setOpenBusy((prev) => ({ ...prev, [filename]: true }));
      setMessage('');
      const res = await apiResponse(
        `/pdf-files/${encodeURIComponent(filename)}`,
      );
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      await openResponseInNewTab(res, filename);
    } catch (err) {
      console.error('Failed to open pdf file.', err);
      setMessage('PDFの取得に失敗しました');
    } finally {
      setOpenBusy((prev) => ({ ...prev, [filename]: false }));
    }
  };

  return (
    <div>
      <h2>PDFファイル一覧</h2>
      <Card padding="small">
        <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
          <Input
            label="filename prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="例: invoice-"
          />
          <Button onClick={loadFiles} loading={isLoading}>
            再読込
          </Button>
        </div>
        {message && (
          <div style={{ marginTop: 8 }}>
            <Alert variant="error">{message}</Alert>
          </div>
        )}
        <div style={{ marginTop: 8, color: '#6b7280' }}>
          {meta ? `件数: ${meta.total}件（表示: ${meta.limit}件）` : '件数: -'}
        </div>
      </Card>

      <div style={{ marginTop: 12 }}>
        {!items.length && <EmptyState title="PDFファイルがありません" />}
        {items.length > 0 && (
          <Card padding="small">
            <table className="table">
              <thead>
                <tr>
                  <th>ファイル名</th>
                  <th>サイズ</th>
                  <th>更新日時</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.filename}>
                    <td>{item.filename}</td>
                    <td>{formatBytes(item.size)}</td>
                    <td>{formatDateTime(item.modifiedAt)}</td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => openPdf(item.filename)}
                        loading={Boolean(openBusy[item.filename])}
                      >
                        開く
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
};
