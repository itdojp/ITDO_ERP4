import assert from "node:assert/strict";
import test from "node:test";

import { captureCurrentPage } from "../src/capture-page-function.js";

function withPage(
  {
    canonical = null,
    metadata = new Map(),
    selection = "<img src=x onerror=alert(1)>",
  } = {},
  fn,
) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    title: "<script>title is text</script>",
    querySelector(selector) {
      if (selector === 'link[rel~="canonical"]') {
        return canonical === null ? null : { getAttribute: () => canonical };
      }
      const value = metadata.get(selector);
      return value === undefined ? null : { getAttribute: () => value };
    },
  };
  globalThis.window = {
    location: { href: "https://example.invalid/current" },
    getSelection: () => ({ toString: () => selection }),
  };
  try {
    return fn();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

test("extracts only title, safe canonical URL, selection, and allowlisted metadata", () =>
  withPage(
    {
      canonical: "/canonical",
      metadata: new Map([
        ['meta[name="description"]', "<script>plain text</script>"],
        ['meta[name="author"]', "Synthetic author"],
        ['meta[property="article:published_time"]', "2026-08-14T00:00:00.000Z"],
      ]),
    },
    () => {
      assert.deepEqual(captureCurrentPage(), {
        title: "<script>title is text</script>",
        url: "https://example.invalid/canonical",
        selectedText: "<img src=x onerror=alert(1)>",
        description: "<script>plain text</script>",
        author: "Synthetic author",
        publishedAt: "2026-08-14T00:00:00.000Z",
      });
    },
  ));

test("ignores an active canonical link and never inspects forms, cookies, or HTML", () =>
  withPage({ canonical: "javascript:alert(1)" }, () => {
    const value = captureCurrentPage();
    assert.equal(value.url, "https://example.invalid/current");
    assert.deepEqual(Object.keys(value), [
      "title",
      "url",
      "selectedText",
      "description",
      "author",
      "publishedAt",
    ]);
  }));

test("rejects an oversized page selection before cross-context handoff", () =>
  withPage({ selection: "x".repeat(64 * 1024 + 1) }, () => {
    assert.equal(captureCurrentPage(), null);
  }));
