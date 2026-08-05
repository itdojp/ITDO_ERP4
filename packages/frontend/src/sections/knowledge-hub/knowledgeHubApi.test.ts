import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiResponse } = vi.hoisted(() => ({ apiResponse: vi.fn() }));

vi.mock('../../api', () => ({ apiResponse }));

import {
  captureKnowledgeTextOrUrl,
  createKnowledgeItem,
  KnowledgeHubApiError,
  listKnowledgeInbox,
  listKnowledgeSnapshots,
  openKnowledgeSnapshotDownload,
  uploadKnowledgeSnapshot,
} from './knowledgeHubApi';

const itemPayload = {
  id: 'item-1',
  ownerUserId: 'user-1',
  scope: 'personal',
  organizationId: null,
  sourceType: 'manual',
  canonicalUrl: null,
  title: 'テスト項目',
  status: 'inbox',
  version: 1,
  capturedAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const snapshotPayload = {
  id: 'snapshot-1',
  knowledgeItemId: 'item-1',
  version: 1,
  status: 'ready',
  captureMethod: 'text',
  sourceUrl: null,
  originalName: 'manual-note.txt',
  contentType: 'text/plain',
  sizeBytes: 12,
  sha256: 'a'.repeat(64),
  failureCode: null,
  capturedAt: '2026-08-06T00:00:00.000Z',
  capturedBy: 'user-1',
  readyAt: '2026-08-06T00:00:01.000Z',
  failedAt: null,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:01.000Z',
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  apiResponse.mockReset();
});

describe('knowledgeHubApi', () => {
  it('normalizes allowlisted item fields and drops provider-only response data', async () => {
    apiResponse.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            ...itemPayload,
            providerUrl: 'https://private-provider.invalid/object',
            providerKey: 'private-key',
          },
        ],
      }),
    );

    const result = await listKnowledgeInbox();

    expect(result).toEqual([itemPayload]);
    expect(JSON.stringify(result)).not.toContain('private-provider');
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('does not expose raw error messages, URLs, or unknown error codes', async () => {
    apiResponse.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'provider_token_expired_private',
            message: 'token=secret https://private-provider.invalid/object',
          },
        },
        502,
      ),
    );

    const error = await listKnowledgeInbox().catch((value) => value);

    expect(error).toBeInstanceOf(KnowledgeHubApiError);
    expect(error).toMatchObject({ code: 'unknown_error', status: 502 });
    expect(String(error)).not.toContain('secret');
    expect(String(error)).not.toContain('private-provider');
  });

  it('preserves only a known sanitized error code', async () => {
    apiResponse.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'snapshot_storage_pending',
            message: 'provider detail must stay hidden',
          },
        },
        502,
      ),
    );

    await expect(listKnowledgeInbox()).rejects.toMatchObject({
      code: 'snapshot_storage_pending',
      status: 502,
      message: 'knowledge_hub_api_error',
    });
  });

  it('builds personal and organization item create payloads explicitly', async () => {
    apiResponse.mockImplementation(async () => jsonResponse(itemPayload, 201));

    await createKnowledgeItem({
      scope: 'personal',
      sourceType: 'manual',
      organizationGroupIds: ['ignored-group'],
      title: null,
    });
    await createKnowledgeItem({
      scope: 'organization',
      sourceType: 'web',
      organizationGroupIds: ['group-a'],
      title: '組織項目',
      canonicalUrl: 'https://example.com/article',
    });

    expect(JSON.parse(apiResponse.mock.calls[0][1].body)).toEqual({
      scope: 'personal',
      sourceType: 'manual',
      status: 'inbox',
    });
    expect(JSON.parse(apiResponse.mock.calls[1][1].body)).toEqual({
      scope: 'organization',
      sourceType: 'web',
      status: 'inbox',
      title: '組織項目',
      canonicalUrl: 'https://example.com/article',
      organizationGroupIds: ['group-a'],
    });
  });

  it('sends text/URL captures with opaque request keys and multipart without JSON headers', async () => {
    apiResponse.mockImplementation(async () =>
      jsonResponse(snapshotPayload, 201),
    );

    await captureKnowledgeTextOrUrl({
      itemId: 'item/1',
      requestKey: 'opaque-key',
      mode: 'text',
      text: 'body',
    });
    await captureKnowledgeTextOrUrl({
      itemId: 'item/1',
      requestKey: 'opaque-url-key',
      mode: 'url',
      url: 'https://example.com/article',
    });
    const file = new File(['%PDF-1.7'], 'sample.pdf', {
      type: 'application/pdf',
    });
    await uploadKnowledgeSnapshot({
      itemId: 'item/1',
      requestKey: 'opaque-upload-key',
      file,
    });

    expect(apiResponse.mock.calls[0][0]).toBe(
      '/knowledge/items/item%2F1/snapshots',
    );
    expect(JSON.parse(apiResponse.mock.calls[0][1].body)).toEqual({
      captureMethod: 'text',
      requestKey: 'opaque-key',
      originalName: 'manual-note.txt',
      text: 'body',
    });
    expect(JSON.parse(apiResponse.mock.calls[1][1].body)).toEqual({
      captureMethod: 'url',
      requestKey: 'opaque-url-key',
      url: 'https://example.com/article',
    });
    expect(apiResponse.mock.calls[2][0]).toContain(
      'requestKey=opaque-upload-key',
    );
    expect(apiResponse.mock.calls[2][1].body).toBeInstanceOf(FormData);
    expect(apiResponse.mock.calls[2][1].headers).toBeUndefined();
  });

  it('normalizes snapshot lists and returns successful downloads as opaque responses', async () => {
    apiResponse
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              ...snapshotPayload,
              providerUrl: 'https://private-provider.invalid/object',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response('snapshot body', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

    const snapshots = await listKnowledgeSnapshots('item-1');
    const download = await openKnowledgeSnapshotDownload({
      itemId: 'item-1',
      snapshotId: 'snapshot-1',
    });

    expect(snapshots).toEqual([snapshotPayload]);
    expect(JSON.stringify(snapshots)).not.toContain('private-provider');
    expect(await download.text()).toBe('snapshot body');
  });
});
