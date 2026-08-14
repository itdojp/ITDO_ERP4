import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from 'fake-indexeddb';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  isBffAuthMode: vi.fn(),
  refreshAuthStateFromServer: vi.fn(),
  revalidateCurrentAuthActor: vi.fn(),
  subscribeAuthSessionChanges: vi.fn(),
}));
const captureApi = vi.hoisted(() => ({
  previewKnowledgeCapture: vi.fn(),
  commitKnowledgeCapture: vi.fn(),
  reconcileKnowledgeCapture: vi.fn(),
}));

vi.mock('../../api', () => ({
  AUTH_STORAGE_KEY: 'erp4_auth',
  ...auth,
}));
vi.mock('./knowledgeCaptureApi', () => captureApi);

import { KnowledgeCaptureIngress } from './KnowledgeCaptureIngress';
import { ShareTargetLanding } from './ShareTargetLanding';
import type {
  IncomingKnowledgeCaptureDraft,
  KnowledgeCaptureSubmission,
} from './knowledgeCaptureModel';
import {
  getShareTargetDraft,
  SHARE_TARGET_DB_NAME,
  SHARE_TARGET_DRAFT_TTL_MS,
  storeShareTargetDraftRecord,
  type ShareTargetDraftRecord,
} from '../../utils/shareTargetQueue';

const originalIndexedDb = Object.getOwnPropertyDescriptor(
  globalThis,
  'indexedDB',
);
const originalIdbKeyRange = Object.getOwnPropertyDescriptor(
  globalThis,
  'IDBKeyRange',
);
const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
  globalThis,
  'BroadcastChannel',
);
const draftId = '0123456789abcdef0123456789abcdef';
const requestKey = 'abcdef0123456789abcdef0123456789';
const actorKey = 'header:synthetic-user';

class FakeBroadcastChannel {
  static instances = new Set<FakeBroadcastChannel>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.add(this);
  }

  postMessage(value: unknown) {
    for (const channel of FakeBroadcastChannel.instances) {
      if (channel !== this && channel.name === this.name && !channel.closed) {
        channel.onmessage?.({ data: value } as MessageEvent<unknown>);
      }
    }
  }

  close() {
    this.closed = true;
    FakeBroadcastChannel.instances.delete(this);
  }
}

function incomingDraft(): IncomingKnowledgeCaptureDraft {
  return {
    schemaVersion: 1,
    channel: 'pwa_share_target',
    title: 'Original title',
    url: 'https://example.invalid/article',
    selectedText: 'Synthetic selected text',
    description: null,
    author: null,
    publishedAt: null,
    capturedAt: '2026-08-14T00:00:00.000Z',
  };
}

function record(): ShareTargetDraftRecord {
  const createdAt = new Date().toISOString();
  return {
    id: draftId,
    requestKey,
    claimedByActorHash: null,
    lifecycle: 'staged',
    pendingIntent: null,
    schemaVersion: 1,
    draft: incomingDraft(),
    createdAt,
    expiresAt: new Date(
      Date.parse(createdAt) + SHARE_TARGET_DRAFT_TTL_MS,
    ).toISOString(),
  };
}

async function deleteDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(SHARE_TARGET_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('share_target_test_database_blocked'));
  });
}

function capturePreview(submission: KnowledgeCaptureSubmission) {
  return {
    captureId: 'capture-1',
    draft: submission.draft,
    selectedFields: submission.selectedFields,
    omittedFields: ['description', 'author', 'publishedAt'],
    scope: submission.scope,
    organizationGroupAccountIds: submission.organizationGroupAccountIds,
    sourceType: submission.sourceType,
    fieldCount: submission.selectedFields.length,
    byteCount: 120,
    duplicateCandidate: { detected: false, status: null },
    requiresOrganizationConfirmation: false,
    previewToken: 'opaque-preview-token',
    expiresAt: '2026-08-14T00:10:00.000Z',
  };
}

function Harness({ clearLanding }: { clearLanding: () => void }) {
  return (
    <>
      <ShareTargetLanding
        draftId={draftId}
        knowledgeHubReady
        activateKnowledgeHub={() => true}
        clearLanding={clearLanding}
      />
      <KnowledgeCaptureIngress />
    </>
  );
}

describe('PWA share-target lifecycle integration', () => {
  beforeEach(async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: fakeIndexedDB,
    });
    Object.defineProperty(globalThis, 'IDBKeyRange', {
      configurable: true,
      value: fakeIDBKeyRange,
    });
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    FakeBroadcastChannel.instances.clear();
    await deleteDatabase();
    await storeShareTargetDraftRecord(record());

    auth.getAuthState.mockReset().mockReturnValue({
      userId: 'synthetic-user',
      roles: [],
    });
    auth.isBffAuthMode.mockReset().mockReturnValue(false);
    auth.refreshAuthStateFromServer.mockReset().mockResolvedValue({
      userId: 'synthetic-user',
      roles: [],
      verifiedActorKey: actorKey,
    });
    auth.revalidateCurrentAuthActor.mockReset().mockResolvedValue(true);
    auth.subscribeAuthSessionChanges
      .mockReset()
      .mockReturnValue(() => undefined);
    captureApi.previewKnowledgeCapture
      .mockReset()
      .mockImplementation(async (submission) => capturePreview(submission));
    captureApi.commitKnowledgeCapture.mockReset();
    captureApi.reconcileKnowledgeCapture.mockReset().mockResolvedValue({
      captureId: 'capture-1',
      requestCaptureId: 'capture-1',
      itemId: 'item-1',
      snapshotId: 'snapshot-1',
      status: 'ready',
      failureCode: null,
      reused: true,
      createdAt: '2026-08-14T00:00:00.000Z',
      committedAt: '2026-08-14T00:00:01.000Z',
      failedAt: null,
    });
  });

  afterEach(async () => {
    cleanup();
    await deleteDatabase();
    FakeBroadcastChannel.instances.clear();
    if (originalIndexedDb) {
      Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
    } else {
      Reflect.deleteProperty(
        globalThis as typeof globalThis & { indexedDB?: unknown },
        'indexedDB',
      );
    }
    if (originalIdbKeyRange) {
      Object.defineProperty(globalThis, 'IDBKeyRange', originalIdbKeyRange);
    } else {
      Reflect.deleteProperty(
        globalThis as typeof globalThis & { IDBKeyRange?: unknown },
        'IDBKeyRange',
      );
    }
    if (originalBroadcastChannel) {
      Object.defineProperty(
        globalThis,
        'BroadcastChannel',
        originalBroadcastChannel,
      );
    } else {
      Reflect.deleteProperty(
        globalThis as typeof globalThis & { BroadcastChannel?: unknown },
        'BroadcastChannel',
      );
    }
  });

  it('does not self-abort commit and reloads the exact edited pending draft for read-only reconcile', async () => {
    let commitSignal: AbortSignal | undefined;
    captureApi.commitKnowledgeCapture.mockImplementationOnce(
      async (_input, signal) => {
        commitSignal = signal;
        return {
          captureId: 'capture-1',
          requestCaptureId: 'capture-1',
          itemId: 'item-1',
          snapshotId: 'snapshot-1',
          status: 'pending',
          failureCode: null,
          reused: false,
          createdAt: '2026-08-14T00:00:00.000Z',
          committedAt: null,
          failedAt: null,
        };
      },
    );
    const first = render(<Harness clearLanding={vi.fn()} />);
    const title = await screen.findByRole('textbox', {
      name: 'ページタイトル',
    });
    fireEvent.change(title, { target: { value: 'Edited exact title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'Exact preview' });
    fireEvent.click(screen.getByLabelText('このexact previewを保存します'));
    fireEvent.click(screen.getByRole('button', { name: '明示確定して保存' }));

    await waitFor(() =>
      expect(captureApi.commitKnowledgeCapture).toHaveBeenCalledTimes(1),
    );
    expect(commitSignal?.aborted).toBe(false);
    expect(await screen.findByText(/保存結果を確認中/)).toBeVisible();
    const pending = await getShareTargetDraft(draftId);
    expect(pending).toMatchObject({
      lifecycle: 'pending',
      pendingIntent: {
        selectedFields: ['title', 'url', 'selectedText'],
        scope: 'personal',
        organizationGroupAccountIds: [],
        sourceType: 'web',
      },
      draft: { title: 'Edited exact title' },
    });

    first.unmount();
    const clearLanding = vi.fn();
    render(<Harness clearLanding={clearLanding} />);
    expect(
      await screen.findByRole('textbox', { name: 'ページタイトル' }),
    ).toHaveValue('Edited exact title');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(captureApi.previewKnowledgeCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: expect.objectContaining({ title: 'Edited exact title' }),
          requestKey,
        }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存結果を再照合' }));
    await waitFor(() =>
      expect(captureApi.reconcileKnowledgeCapture).toHaveBeenCalledTimes(1),
    );
    expect(captureApi.commitKnowledgeCapture).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(clearLanding).toHaveBeenCalledOnce());
    await expect(getShareTargetDraft(draftId)).resolves.toBeNull();
  });
});
