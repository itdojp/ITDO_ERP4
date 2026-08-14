import assert from "node:assert/strict";
import test from "node:test";

import {
  applySelectedFields,
  captureLimits,
  defaultSelectedFields,
  normalizeCaptureDraft,
  normalizeExtractedCapture,
} from "../src/capture-contract.js";

const capturedAt = "2026-08-14T00:00:00.000Z";

test("normalizes only allowlisted metadata and defaults to minimal fields", () => {
  const value = normalizeExtractedCapture(
    {
      title: " Synthetic page ",
      url: "https://example.invalid/article",
      selectedText: "selected",
      description: "description",
      author: "author",
      publishedAt: "2026-08-13T12:00:00.000Z",
      arbitraryMetadata: "dropped",
    },
    capturedAt,
  );
  assert.deepEqual(value, {
    schemaVersion: 1,
    channel: "browser_extension",
    title: "Synthetic page",
    url: "https://example.invalid/article",
    selectedText: "selected",
    description: "description",
    author: "author",
    publishedAt: "2026-08-13T12:00:00.000Z",
    capturedAt,
  });
  assert.deepEqual(defaultSelectedFields(value), [
    "title",
    "url",
    "selectedText",
  ]);
  assert.equal("arbitraryMetadata" in value, false);
});

test("selected fields remove omitted data from the staged draft", () => {
  const draft = normalizeExtractedCapture(
    {
      title: "title",
      url: "https://example.invalid/",
      selectedText: "selected",
      description: "private-description-canary",
      author: "private-author-canary",
    },
    capturedAt,
  );
  const selected = applySelectedFields(draft, ["title", "selectedText"]);
  assert.equal(selected.title, "title");
  assert.equal(selected.selectedText, "selected");
  assert.equal(selected.url, null);
  assert.equal(selected.description, null);
  assert.equal(selected.author, null);
  assert.equal(JSON.stringify(selected).includes("private-description"), false);
});

test("rejects active schemes, credential URLs, malformed Unicode, and nested payloads", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,secret",
    "file:///etc/passwd",
    "chrome://settings",
    "edge://settings",
    "about:blank",
    "https://user:password@example.invalid/",
    "https://example.invalid/reset?token=synthetic-secret",
    "https://example.invalid/callback?code=synthetic-code",
    "https://example.invalid/download?Expires=123456",
    "https://example.invalid/?AWSAccessKeyId=synthetic",
    "https://example.invalid/?PHPSESSID=synthetic-secret",
    "https://example.invalid/?sessid=synthetic-secret",
    "https://example.invalid/?sid=synthetic-secret",
    "https://example.invalid/?sessionid=a1b2c3d4e5f6",
    "https://example.invalid/?%2574%256f%256b%2565%256e=a1b2c3",
    "https://example.invalid/?next=https%3A%2F%2Fnested.invalid%2F%3Faccess_token%3Dsynthetic",
    "https://example.invalid/?next=https%3A%2F%2Falice%3Aa1b2c3d4%40nested.invalid%2Fprivate",
    "https://example.invalid/?next=https%3A%2F%2Fnested.invalid%2Fpath%3Fsessionid%3Da1b2c3",
    "https://example.invalid/?next=https%3A%2F%2Fnested.invalid%2Fapp%253Bjsessionid%253Dsynthetic-secret",
    "https://example.invalid/?next=https%3A%2F%2Fnested.invalid%2Fpath%2F%253Ftoken%253Dsynthetic-secret",
    "https://example.invalid/?next=https%3A%2F%2Fnested.invalid%2Fredirect%2Fhttps%253Aalice%253Asynthetic-pass%2540deep.invalid%2Fprivate",
    "https://example.invalid/?next=https:%5C%5Calice:synthetic-pass@nested.invalid/private",
    "https://example.invalid/?next=%5C%5Calice%3Asynthetic-pass%40nested.invalid%2Fprivate",
    "https://example.invalid/?next=%5C%2Falice%3Asynthetic-pass%40nested.invalid%2Fprivate",
    "https://example.invalid/?next=%255C%255Calice%253Asynthetic-pass%2540nested.invalid%252Fprivate",
    "https://example.invalid/?next=https%3A%2Falice%3Asynthetic-pass%40nested.invalid/private",
    "https://example.invalid/?next=https%3Aalice%3Asynthetic-pass%40nested.invalid%2Fprivate",
    "https://example.invalid/?next=http%3Aalice%3Asynthetic-pass%40nested.invalid%2Fprivate",
    "https://example.invalid/?next=ht%09tps%3Aalice%3Asynthetic-pass%40nested.invalid%2Fprivate",
    "https://example.invalid/?next=ht%0Atps%3Aalice%3Asynthetic-pass%40nested.invalid%2Fprivate",
    "https://example.invalid/?next=h%0Dttps%3Aalice%3Asynthetic-pass%40nested.invalid%2Fprivate",
    "https://example.invalid/?next=ht%250Atps%253Aalice%253Asynthetic-pass%2540nested.invalid%252Fprivate",
    "https://example.invalid/redirect/https%3A%2F%2Fnested.invalid%2F%3Faccess_token%3Dsynthetic-secret",
    "https://example.invalid/redirect/https%253A%252F%252Fnested.invalid%252F%253Fsessionid%253Dsynthetic-secret",
    "https://example.invalid/redirect/https%3Aalice%3Asynthetic-pass%40nested.invalid/private",
    "https://example.invalid/redirect/https%253Aalice%253Asynthetic-pass%2540nested.invalid/private",
    "https://example.invalid/redirect/ht%0Atps%3Aalice%3Asynthetic-pass%40nested.invalid%2Fprivate",
    "https://example.invalid/redirect/ht%250Atps%253Aalice%253Asynthetic-pass%2540nested.invalid%252Fprivate",
    "https://example.invalid/session/synthetic-secret",
    "https://example.invalid/token/synthetic-secret",
    "https://example.invalid/sid/synthetic-secret",
    "https://example.invalid/%73ession/synthetic-secret",
    "https://example.invalid/%2573ession/synthetic-secret",
    "https://example.invalid/app;jsessionid=synthetic-secret",
    "https://example.invalid/path/%3Ftoken%3Dsynthetic-secret",
    "https://example.invalid/article#access_token=never-stored",
  ]) {
    assert.equal(normalizeExtractedCapture({ url }, capturedAt), null, url);
  }
  assert.equal(
    normalizeExtractedCapture({ title: "x\u0000y" }, capturedAt),
    null,
  );
  assert.equal(
    normalizeExtractedCapture({ title: "\ud800" }, capturedAt),
    null,
  );
  assert.equal(
    normalizeExtractedCapture(
      { title: "safe", nested: { secret: true } },
      capturedAt,
    ),
    null,
  );
  assert.equal(
    normalizeExtractedCapture(
      { title: "safe", unknown: "hidden\u202esecret" },
      capturedAt,
    ),
    null,
  );
});

test("keeps ordinary slash routes that do not name a credential value", () => {
  for (const url of [
    "https://example.invalid/session",
    "https://example.invalid/sessions/archive",
    "https://example.invalid/tokens/example",
    "https://example.invalid/state/california",
    "https://example.invalid/code/example",
    "https://example.invalid/key/rotation",
  ]) {
    assert.equal(normalizeExtractedCapture({ url }, capturedAt)?.url, url, url);
  }
});

test("strips fragments and tracking parameters before session staging", () => {
  const value = normalizeExtractedCapture(
    {
      title: "safe",
      url: "https://example.invalid/article?z=last&utm_source=synthetic&lang=ja#section",
    },
    capturedAt,
  );
  assert.equal(value.url, "https://example.invalid/article?lang=ja&z=last");
  assert.equal(JSON.stringify(value).includes("section"), false);
  assert.equal(JSON.stringify(value).includes("utm_source"), false);
});

test("rejects field and total bounds without truncating content", () => {
  assert.equal(
    normalizeExtractedCapture(
      { selectedText: "x".repeat(captureLimits.selectedTextBytes + 1) },
      capturedAt,
    ),
    null,
  );
  assert.equal(
    normalizeExtractedCapture(
      {
        title: "safe",
        unknown: "x".repeat(captureLimits.totalBytes),
      },
      capturedAt,
    ),
    null,
  );
});

test("stored drafts require exact channel, schema, and instant", () => {
  const valid = normalizeExtractedCapture(
    { title: "valid", url: "https://example.invalid/" },
    capturedAt,
  );
  assert.deepEqual(normalizeCaptureDraft(valid), valid);
  assert.equal(
    normalizeCaptureDraft({ ...valid, channel: "pwa_share_target" }),
    null,
  );
  assert.equal(
    normalizeCaptureDraft({ ...valid, capturedAt: "not-a-date" }),
    null,
  );
  assert.equal(normalizeCaptureDraft({ ...valid, nested: [] }), null);
});
