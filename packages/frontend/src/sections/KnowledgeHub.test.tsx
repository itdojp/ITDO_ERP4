import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  captureKnowledgeTextOrUrl: vi.fn(),
  createKnowledgeItem: vi.fn(),
  listKnowledgeInbox: vi.fn(),
  listKnowledgeSnapshots: vi.fn(),
  openKnowledgeSnapshotDownload: vi.fn(),
  reconcileKnowledgeSnapshot: vi.fn(),
  uploadKnowledgeSnapshot: vi.fn(),
}));
const { downloadResponseAsFile } = vi.hoisted(() => ({
  downloadResponseAsFile: vi.fn(),
}));

vi.mock('./knowledge-hub/knowledgeHubApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./knowledge-hub/knowledgeHubApi')>()),
  ...apiMocks,
}));
vi.mock('../utils/download', () => ({ downloadResponseAsFile }));
vi.mock('./knowledge-hub/KnowledgeProvenanceWorkspace', () => ({
  KnowledgeProvenanceWorkspace: ({ itemLabel }: { itemLabel: string }) => (
    <div>provenance workspace: {itemLabel}</div>
  ),
}));

import { KnowledgeHub } from './KnowledgeHub';
import { KnowledgeHubApiError } from './knowledge-hub/knowledgeHubApi';
import type {
  KnowledgeItem,
  KnowledgeSnapshot,
} from './knowledge-hub/knowledgeHubModel';

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 'item-1',
    ownerUserId: 'demo-user',
    scope: 'personal',
    organizationId: null,
    sourceType: 'manual',
    canonicalUrl: null,
    title: '検証用ナレッジ',
    status: 'inbox',
    version: 1,
    capturedAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<KnowledgeSnapshot> = {},
): KnowledgeSnapshot {
  return {
    id: 'snapshot-1',
    knowledgeItemId: 'item-1',
    version: 1,
    status: 'ready',
    captureMethod: 'text',
    sourceUrl: null,
    originalName: 'manual-note.txt',
    contentType: 'text/plain',
    sizeBytes: 18,
    sha256: 'a'.repeat(64),
    failureCode: null,
    capturedAt: '2026-08-06T00:00:00.000Z',
    capturedBy: 'demo-user',
    readyAt: '2026-08-06T00:00:01.000Z',
    failedAt: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listKnowledgeInbox.mockResolvedValue([]);
  apiMocks.listKnowledgeSnapshots.mockResolvedValue([]);
  apiMocks.createKnowledgeItem.mockResolvedValue(makeItem());
  apiMocks.captureKnowledgeTextOrUrl.mockResolvedValue(makeSnapshot());
  apiMocks.uploadKnowledgeSnapshot.mockResolvedValue(
    makeSnapshot({ captureMethod: 'upload' }),
  );
  apiMocks.reconcileKnowledgeSnapshot.mockResolvedValue(makeSnapshot());
  apiMocks.openKnowledgeSnapshotDownload.mockResolvedValue(
    new Response('snapshot body', { status: 200 }),
  );
  downloadResponseAsFile.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('KnowledgeHub', () => {
  it('loads an empty Inbox with personal/new/text as the safe defaults', async () => {
    render(<KnowledgeHub />);

    await waitFor(() =>
      expect(apiMocks.listKnowledgeInbox).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible();
    expect(screen.getByLabelText('保存先')).toHaveValue('new');
    expect(screen.getByLabelText('保存形式')).toHaveValue('text');
    expect(screen.getByLabelText('scope')).toHaveValue('personal');
    expect(screen.getByText('Inboxは空です')).toBeVisible();
    expect(
      screen.getByText(/会社運用者、監査、バックアップから独立/),
    ).toBeVisible();
  });

  it('creates a personal inbox item and immutable text snapshot', async () => {
    const item = makeItem({ title: '保存した記事' });
    const snapshot = makeSnapshot();
    apiMocks.createKnowledgeItem.mockResolvedValue(item);
    apiMocks.captureKnowledgeTextOrUrl.mockResolvedValue(snapshot);
    apiMocks.listKnowledgeSnapshots.mockResolvedValue([snapshot]);
    render(<KnowledgeHub />);

    await waitFor(() => expect(apiMocks.listKnowledgeInbox).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('タイトル（任意）'), {
      target: { value: '保存した記事' },
    });
    fireEvent.change(screen.getByLabelText('保存するテキスト'), {
      target: { value: '外部情報の保存時点本文' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Inboxへ保存' }));

    await waitFor(() =>
      expect(apiMocks.createKnowledgeItem).toHaveBeenCalledWith({
        canonicalUrl: undefined,
        organizationGroupIds: [],
        scope: 'personal',
        sourceType: 'manual',
        title: '保存した記事',
      }),
    );
    expect(apiMocks.captureKnowledgeTextOrUrl).toHaveBeenCalledWith({
      itemId: 'item-1',
      requestKey: expect.any(String),
      mode: 'text',
      text: '外部情報の保存時点本文',
      url: undefined,
    });
    expect(
      await screen.findByText('スナップショット version 1 を保存しました。'),
    ).toBeVisible();
    expect(
      screen.getByRole('article', { name: 'version 1' }),
    ).toHaveTextContent('a'.repeat(64));
    expect(screen.getByLabelText('保存するテキスト')).toHaveValue('');
  });

  it('creates a web item and URL snapshot without displaying provider fields', async () => {
    const item = {
      ...makeItem({
        sourceType: 'web',
        canonicalUrl: 'https://example.com/article',
      }),
      providerUrl: 'https://private-provider.invalid/object',
    } as KnowledgeItem;
    const snapshot = {
      ...makeSnapshot({
        captureMethod: 'url',
        sourceUrl: 'https://example.com/article',
      }),
      providerKey: 'private-provider-key',
    } as KnowledgeSnapshot;
    apiMocks.createKnowledgeItem.mockResolvedValue(item);
    apiMocks.captureKnowledgeTextOrUrl.mockResolvedValue(snapshot);
    apiMocks.listKnowledgeSnapshots.mockResolvedValue([snapshot]);
    render(<KnowledgeHub />);

    await waitFor(() => expect(apiMocks.listKnowledgeInbox).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('保存形式'), {
      target: { value: 'url' },
    });
    fireEvent.change(screen.getByLabelText('保存するURL'), {
      target: { value: 'https://example.com/article' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Inboxへ保存' }));

    await waitFor(() =>
      expect(apiMocks.createKnowledgeItem).toHaveBeenCalledWith(
        expect.objectContaining({
          canonicalUrl: 'https://example.com/article',
          sourceType: 'web',
        }),
      ),
    );
    expect(apiMocks.captureKnowledgeTextOrUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'url',
        url: 'https://example.com/article',
      }),
    );
    expect(
      await screen.findByText('https://example.com/article'),
    ).toBeVisible();
    expect(screen.queryByText(/private-provider/)).not.toBeInTheDocument();
  });

  it.each([
    {
      mode: 'pdf',
      modeLabel: 'PDF',
      inputLabel: 'PDFファイル',
      file: new File(['%PDF-1.7'], 'sample.pdf', {
        type: 'application/pdf',
      }),
    },
    {
      mode: 'image',
      modeLabel: '画像',
      inputLabel: '画像ファイル',
      file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'sample.png', {
        type: 'image/png',
      }),
    },
  ] as const)(
    'uploads a validated $modeLabel file with multipart capture',
    async ({ mode, inputLabel, file }) => {
      const item = makeItem({ sourceType: mode });
      const snapshot = makeSnapshot({
        captureMethod: 'upload',
        originalName: file.name,
        contentType: file.type,
      });
      apiMocks.createKnowledgeItem.mockResolvedValue(item);
      apiMocks.uploadKnowledgeSnapshot.mockResolvedValue(snapshot);
      apiMocks.listKnowledgeSnapshots.mockResolvedValue([snapshot]);
      render(<KnowledgeHub />);

      await waitFor(() =>
        expect(apiMocks.listKnowledgeInbox).toHaveBeenCalled(),
      );
      fireEvent.change(screen.getByLabelText('保存形式'), {
        target: { value: mode },
      });
      const fileInput = screen.getByLabelText(inputLabel) as HTMLInputElement;
      fireEvent.change(fileInput, {
        target: { files: [file] },
      });
      expect(fileInput.files?.[0]).toBe(file);
      fireEvent.click(screen.getByRole('button', { name: 'Inboxへ保存' }));

      await waitFor(() =>
        expect(apiMocks.createKnowledgeItem).toHaveBeenCalled(),
      );
      await waitFor(() =>
        expect(apiMocks.uploadKnowledgeSnapshot).toHaveBeenCalledWith({
          itemId: 'item-1',
          requestKey: expect.any(String),
          file,
        }),
      );
      expect(apiMocks.createKnowledgeItem).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: mode }),
      );
    },
  );

  it('requires explicit organization grant input and confirmation before mutation', async () => {
    render(<KnowledgeHub />);

    await waitFor(() => expect(apiMocks.listKnowledgeInbox).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('scope'), {
      target: { value: 'organization' },
    });
    fireEvent.change(screen.getByLabelText('保存するテキスト'), {
      target: { value: '組織へ共有する本文' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Inboxへ保存' }));
    expect(await screen.findByText(/共有先グループIDを1件以上/)).toBeVisible();
    expect(apiMocks.createKnowledgeItem).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('共有先グループID'), {
      target: { value: 'group-a, group-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Inboxへ保存' }));
    expect(
      await screen.findByText(
        '組織の共有範囲へ保存することを確認してください。',
      ),
    ).toBeVisible();
    expect(apiMocks.createKnowledgeItem).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByLabelText('組織の共有範囲へ保存することを確認しました'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Inboxへ保存' }));
    await waitFor(() =>
      expect(apiMocks.createKnowledgeItem).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'organization',
          organizationGroupIds: ['group-a', 'group-b'],
        }),
      ),
    );
  });

  it('keeps a created item on partial failure and reconciles only with the current-session key', async () => {
    const pending = makeSnapshot({
      status: 'pending',
      sha256: null,
      sizeBytes: null,
      contentType: null,
      readyAt: null,
    });
    const ready = makeSnapshot();
    apiMocks.captureKnowledgeTextOrUrl.mockRejectedValue(
      new KnowledgeHubApiError('snapshot_storage_pending', 502),
    );
    apiMocks.listKnowledgeSnapshots.mockResolvedValue([pending]);
    apiMocks.reconcileKnowledgeSnapshot.mockResolvedValue(ready);
    render(<KnowledgeHub />);

    await waitFor(() => expect(apiMocks.listKnowledgeInbox).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('保存するテキスト'), {
      target: { value: '保存結果が不明になる本文' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Inboxへ保存' }));

    expect(
      await screen.findByText(/Inbox項目は保持されました。保存結果を確認中/),
    ).toBeVisible();
    const captureInput = apiMocks.captureKnowledgeTextOrUrl.mock.calls[0][0];
    const reconcileButton = screen.getByRole('button', {
      name: '保存結果を再照合',
    });
    fireEvent.click(reconcileButton);

    await waitFor(() =>
      expect(apiMocks.reconcileKnowledgeSnapshot).toHaveBeenCalledWith({
        itemId: 'item-1',
        snapshotId: 'snapshot-1',
        requestKey: captureInput.requestKey,
      }),
    );
    expect(
      await screen.findByText('version 1 の保存結果を確認しました。'),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent(captureInput.requestKey);
  });

  it('adds a version to the selected item without creating another item', async () => {
    const item = makeItem();
    const versionOne = makeSnapshot();
    const versionTwo = makeSnapshot({
      id: 'snapshot-2',
      version: 2,
      sha256: 'b'.repeat(64),
    });
    apiMocks.listKnowledgeInbox.mockResolvedValue([item]);
    apiMocks.listKnowledgeSnapshots.mockResolvedValue([versionOne]);
    apiMocks.captureKnowledgeTextOrUrl.mockResolvedValue(versionTwo);
    render(<KnowledgeHub />);

    await screen.findByRole('article', { name: 'version 1' });
    fireEvent.change(screen.getByLabelText('保存先'), {
      target: { value: 'selected' },
    });
    fireEvent.change(screen.getByLabelText('保存するテキスト'), {
      target: { value: '更新時点の本文' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '新しいversionを保存' }),
    );

    expect(
      await screen.findByText('スナップショット version 2 を保存しました。'),
    ).toBeVisible();
    expect(apiMocks.createKnowledgeItem).not.toHaveBeenCalled();
    expect(apiMocks.captureKnowledgeTextOrUrl).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'item-1', text: '更新時点の本文' }),
    );
    expect(screen.getByRole('article', { name: 'version 2' })).toBeVisible();
  });

  it('requires explicit confirmation when appending to an organization item', async () => {
    const organizationItem = makeItem({
      scope: 'organization',
      organizationId: 'organization-1',
    });
    apiMocks.listKnowledgeInbox.mockResolvedValue([organizationItem]);
    apiMocks.listKnowledgeSnapshots.mockResolvedValue([makeSnapshot()]);
    render(<KnowledgeHub />);

    await screen.findByRole('article', { name: 'version 1' });
    fireEvent.change(screen.getByLabelText('保存先'), {
      target: { value: 'selected' },
    });
    fireEvent.change(screen.getByLabelText('保存するテキスト'), {
      target: { value: '組織項目へ追加する本文' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '新しいversionを保存' }),
    );

    expect(
      await screen.findByText(
        '組織の共有範囲へ保存することを確認してください。',
      ),
    ).toBeVisible();
    expect(apiMocks.captureKnowledgeTextOrUrl).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByLabelText('組織の共有範囲へ保存することを確認しました'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '新しいversionを保存' }),
    );
    await waitFor(() =>
      expect(apiMocks.captureKnowledgeTextOrUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'item-1',
          text: '組織項目へ追加する本文',
        }),
      ),
    );
    expect(apiMocks.createKnowledgeItem).not.toHaveBeenCalled();
  });

  it('downloads only a ready snapshot through the authorized API response', async () => {
    const item = makeItem();
    const ready = makeSnapshot();
    apiMocks.listKnowledgeInbox.mockResolvedValue([item]);
    apiMocks.listKnowledgeSnapshots.mockResolvedValue([ready]);
    render(<KnowledgeHub />);

    await screen.findByRole('article', { name: 'version 1' });
    fireEvent.click(
      screen.getByRole('button', {
        name: '認可済みファイルをダウンロード',
      }),
    );

    await waitFor(() =>
      expect(apiMocks.openKnowledgeSnapshotDownload).toHaveBeenCalledWith({
        itemId: 'item-1',
        snapshotId: 'snapshot-1',
      }),
    );
    expect(downloadResponseAsFile).toHaveBeenCalledWith(
      expect.any(Response),
      'manual-note.txt',
    );
    expect(
      await screen.findByText('version 1 をダウンロードしました。'),
    ).toBeVisible();
  });

  it('does not show a reconcile action for pending snapshots from an earlier session', async () => {
    apiMocks.listKnowledgeInbox.mockResolvedValue([makeItem()]);
    apiMocks.listKnowledgeSnapshots.mockResolvedValue([
      makeSnapshot({ status: 'pending', readyAt: null, sha256: null }),
    ]);
    render(<KnowledgeHub />);

    expect(
      await screen.findByText(/このsessionには照合用のrequest keyがありません/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '保存結果を再照合' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: '認可済みファイルをダウンロード',
      }),
    ).not.toBeInTheDocument();
  });
});
