import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiResponse } = vi.hoisted(() => ({ apiResponse: vi.fn() }));
vi.mock('../../api', () => ({ apiResponse }));

import {
  commitKnowledgeCapture,
  previewKnowledgeCapture,
  reconcileKnowledgeCapture,
} from './knowledgeCaptureApi';

const draft = {
  schemaVersion: 1 as const,
  channel: 'browser_extension' as const,
  title: 'Synthetic page',
  url: 'https://example.invalid/',
  selectedText: null,
  description: 'Unselected description',
  author: null,
  publishedAt: null,
  capturedAt: '2026-08-14T00:00:00.000Z',
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const resultPayload = {
  captureId: 'capture-1',
  requestCaptureId: 'capture-1',
  itemId: 'item-1',
  snapshotId: 'snapshot-1',
  status: 'ready',
  failureCode: null,
  reused: false,
  createdAt: '2026-08-14T00:00:00.000Z',
  committedAt: '2026-08-14T00:00:01.000Z',
  failedAt: null,
};

beforeEach(() => apiResponse.mockReset());

describe('knowledge capture API boundary', () => {
  it('normalizes the preview allowlist and discards provider/internal fields', async () => {
    apiResponse.mockResolvedValueOnce(
      response({
        captureId: 'capture-1',
        normalizedDraft: { ...draft, providerKey: 'private-canary' },
        selectedFields: ['title', 'url'],
        omittedFields: ['description'],
        scope: 'personal',
        sourceType: 'web',
        fieldCount: 2,
        byteCount: 100,
        duplicateCandidate: {
          detected: false,
          status: null,
          itemId: 'private',
        },
        requiresOrganizationConfirmation: false,
        previewToken: 'opaque-token',
        expiresAt: '2026-08-14T00:10:00.000Z',
        requestKey: 'private-canary',
      }),
    );
    const value = await previewKnowledgeCapture({
      draft,
      selectedFields: ['title', 'url'],
      scope: 'personal',
      organizationGroupAccountIds: [],
      sourceType: 'web',
      requestKey: 'private-request-key',
    });
    expect(JSON.parse(apiResponse.mock.calls[0][1].body).requestKey).toBe(
      'private-request-key',
    );
    expect(value.draft).toEqual(draft);
    expect(JSON.stringify(value)).not.toContain('providerKey');
    expect(JSON.stringify(value)).not.toContain('private-canary');
  });

  it('sends explicit confirmation fields and never exposes request key in results', async () => {
    apiResponse.mockResolvedValueOnce(response(resultPayload, 201));
    const preview = {
      captureId: 'capture-1',
      draft,
      selectedFields: ['title', 'url'] as const,
      omittedFields: ['description'] as const,
      scope: 'personal' as const,
      organizationGroupAccountIds: [],
      sourceType: 'web' as const,
      fieldCount: 2,
      byteCount: 100,
      duplicateCandidate: { detected: false, status: null },
      requiresOrganizationConfirmation: false,
      previewToken: 'opaque-token',
      expiresAt: '2026-08-14T00:10:00.000Z',
    };
    const value = await commitKnowledgeCapture({
      preview: preview as never,
      requestKey: 'private-request-key',
      organizationConfirmed: false,
    });
    const body = JSON.parse(apiResponse.mock.calls[0][1].body);
    expect(body).toMatchObject({
      confirmed: true,
      organizationConfirmed: false,
      previewToken: 'opaque-token',
      requestKey: 'private-request-key',
    });
    expect(JSON.stringify(value)).not.toContain('private-request-key');
  });

  it('reconciles by opaque capture ID with no payload replay', async () => {
    apiResponse.mockResolvedValueOnce(
      response({
        ...resultPayload,
        captureId: 'prior-capture',
        requestCaptureId: 'capture/one',
        status: 'pending',
        committedAt: null,
      }),
    );
    const preview = {
      captureId: 'capture/one',
      draft,
      selectedFields: ['title', 'url'] as const,
      omittedFields: ['description'] as const,
      scope: 'personal' as const,
      organizationGroupAccountIds: [],
      sourceType: 'web' as const,
      fieldCount: 2,
      byteCount: 100,
      duplicateCandidate: { detected: false, status: null },
      requiresOrganizationConfirmation: false,
      previewToken: 'opaque-token',
      expiresAt: '2026-08-14T00:10:00.000Z',
    };
    const value = await reconcileKnowledgeCapture({
      preview: preview as never,
      requestKey: 'private-request-key',
    });
    expect(apiResponse).toHaveBeenCalledWith(
      '/knowledge/captures/capture%2Fone/reconcile',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = JSON.parse(apiResponse.mock.calls[0][1].body);
    expect(body).toMatchObject({
      previewToken: 'opaque-token',
      requestKey: 'private-request-key',
    });
    expect(value.captureId).toBe('prior-capture');
    expect(value.requestCaptureId).toBe('capture/one');
  });

  it('rejects a successful result that is not bound to the requested preview capture', async () => {
    apiResponse.mockResolvedValueOnce(
      response({ ...resultPayload, requestCaptureId: 'other-preview' }),
    );
    const preview = {
      captureId: 'capture-1',
      draft,
      selectedFields: ['title', 'url'] as const,
      omittedFields: ['description'] as const,
      scope: 'personal' as const,
      organizationGroupAccountIds: [],
      sourceType: 'web' as const,
      fieldCount: 2,
      byteCount: 100,
      duplicateCandidate: { detected: false, status: null },
      requiresOrganizationConfirmation: false,
      previewToken: 'opaque-token',
      expiresAt: '2026-08-14T00:10:00.000Z',
    };
    await expect(
      commitKnowledgeCapture({
        preview: preview as never,
        requestKey: 'private-request-key',
        organizationConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
