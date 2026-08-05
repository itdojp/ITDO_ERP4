import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractKnowledgeHtmlText,
  materializeKnowledgeText,
  materializeKnowledgeUpload,
  materializeKnowledgeUrl,
} from '../dist/application/knowledge/knowledgeSnapshotCapture.js';
import { knowledgeSnapshotLimits } from '../dist/application/knowledge/knowledgeSnapshotPorts.js';

test('manual text capture is UTF-8 bounded and preserves an inert text representation', () => {
  const captured = materializeKnowledgeText({
    text: '検証用の手動メモ',
    originalName: '../unsafe\nname.txt',
  });
  assert.equal(captured.contentType, 'text/plain');
  assert.equal(captured.extractedText, '検証用の手動メモ');
  assert.equal(captured.originalName, '.._unsafe_name.txt');
  assert.deepEqual(captured.body, Buffer.from('検証用の手動メモ'));

  assert.throws(
    () =>
      materializeKnowledgeText({
        text: 'a'.repeat(1024 * 1024 + 1),
      }),
    { message: 'snapshot_content_too_large' },
  );
});

test('HTML capture removes active elements and returns plain text only', () => {
  const body = Buffer.from(`
    <html><head><style>secret-style</style></head>
    <body><h1>Safe &amp; visible</h1>
      <script>stealCredential()</script>
      <iframe src="https://private.invalid">hidden frame</iframe>
      <p>Second line</p>
    </body></html>
  `);
  const extracted = extractKnowledgeHtmlText(body);
  assert.equal(extracted, 'Safe & visible Second line');
  assert.doesNotMatch(extracted, /script|iframe|stealCredential|secret-style/);
});

test('upload capture enforces allowlisted MIME and file signatures', () => {
  const pdf = materializeKnowledgeUpload({
    body: Buffer.from('%PDF-1.7\nfixture'),
    contentType: 'application/pdf',
    originalName: 'fixture.pdf',
  });
  assert.equal(pdf.contentType, 'application/pdf');
  assert.equal(pdf.extractedText, null);

  assert.throws(
    () =>
      materializeKnowledgeUpload({
        body: Buffer.from('<svg><script>alert(1)</script></svg>'),
        contentType: 'image/svg+xml',
        originalName: 'active.svg',
      }),
    { message: 'snapshot_content_type_unsupported' },
  );
  assert.throws(
    () =>
      materializeKnowledgeUpload({
        body: Buffer.from('not-a-pdf'),
        contentType: 'application/pdf',
        originalName: 'spoofed.pdf',
      }),
    { message: 'snapshot_content_invalid' },
  );
});

test('URL capture passes a scrubbed URL to safe fetch and bounds declared size/type', async () => {
  let fetchedUrl;
  const captured = await materializeKnowledgeUrl(
    {
      url: 'https://example.test/article?utm_source=tracker&view=full#fragment',
    },
    {
      fetchImpl: async (url, init, options) => {
        fetchedUrl = url;
        assert.ok(init.signal);
        assert.equal(options.timeoutMs, 10000);
        return new Response('<h1>Public page</h1><script>bad()</script>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
    },
  );
  assert.equal(fetchedUrl, 'https://example.test/article?view=full');
  assert.equal(captured.sourceUrl, fetchedUrl);
  assert.equal(captured.extractedText, 'Public page');

  await assert.rejects(
    materializeKnowledgeUrl(
      { url: 'https://example.test/large' },
      {
        fetchImpl: async () =>
          new Response('small', {
            headers: {
              'content-type': 'text/plain',
              'content-length': String(
                knowledgeSnapshotLimits.maxTextBytes + 1,
              ),
            },
          }),
      },
    ),
    { message: 'snapshot_content_too_large' },
  );

  await assert.rejects(
    materializeKnowledgeUrl(
      { url: 'https://example.test/vector' },
      {
        fetchImpl: async () =>
          new Response('<svg/>', {
            headers: { 'content-type': 'image/svg+xml' },
          }),
      },
    ),
    { message: 'snapshot_content_type_unsupported' },
  );
});

test('URL capture rejects credential-bearing URLs before fetch', async () => {
  for (const url of [
    'https://example.test/page?access_token=do-not-store',
    'https://user:password@example.test/private',
  ]) {
    let called = false;
    await assert.rejects(
      materializeKnowledgeUrl(
        { url },
        {
          fetchImpl: async () => {
            called = true;
            return new Response('unexpected');
          },
        },
      ),
      { message: 'snapshot_content_invalid' },
    );
    assert.equal(called, false);
  }
});

test('URL body timeout cancels a stalled response stream', async () => {
  let cancelled = false;
  const stalled = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  const startedAt = Date.now();
  await assert.rejects(
    materializeKnowledgeUrl(
      { url: 'https://example.test/stalled' },
      {
        timeoutMs: 20,
        fetchImpl: async () =>
          new Response(stalled, {
            headers: { 'content-type': 'text/plain' },
          }),
      },
    ),
    { message: 'snapshot_capture_timeout' },
  );
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(cancelled, true);
});

test('URL capture stops text bodies at the text-specific byte limit and cancels the reader', async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(
        new Uint8Array(knowledgeSnapshotLimits.maxTextBytes + 1),
      );
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    materializeKnowledgeUrl(
      { url: 'https://example.test/oversized-text' },
      {
        fetchImpl: async () =>
          new Response(body, {
            headers: { 'content-type': 'text/plain' },
          }),
      },
    ),
    { message: 'snapshot_content_too_large' },
  );
  assert.ok(pulls <= 2, `reader pulled too many oversized chunks: ${pulls}`);
  assert.equal(cancelled, true);
});

test('URL capture cancels response bodies on pre-read size and HTTP status failures', async (t) => {
  for (const scenario of [
    {
      name: 'declared body exceeds limit',
      status: 200,
      headers: {
        'content-type': 'text/plain',
        'content-length': String(knowledgeSnapshotLimits.maxTextBytes + 1),
      },
      error: 'snapshot_content_too_large',
    },
    {
      name: 'non-success HTTP status',
      status: 503,
      headers: { 'content-type': 'text/plain' },
      error: 'snapshot_capture_failed',
    },
  ]) {
    await t.test(scenario.name, async () => {
      let cancelled = false;
      const body = new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          cancelled = true;
        },
      });
      await assert.rejects(
        materializeKnowledgeUrl(
          { url: 'https://example.test/failure' },
          {
            fetchImpl: async () =>
              new Response(body, {
                status: scenario.status,
                headers: scenario.headers,
              }),
          },
        ),
        { message: scenario.error },
      );
      assert.equal(cancelled, true);
    });
  }
});
