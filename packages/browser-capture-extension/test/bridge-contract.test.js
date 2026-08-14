import assert from "node:assert/strict";
import test from "node:test";

import {
  isExactErp4Sender,
  isExtensionPageSender,
} from "../src/bridge-contract.js";

const runtime = {
  id: "abcdefghijklmnopabcdefghijklmnop",
  getURL: (path) =>
    `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`,
};
const erp4Origin = "https://erp4.example.invalid";

test("accepts only pages owned by this extension", () => {
  assert.equal(
    isExtensionPageSender(
      {
        id: runtime.id,
        url: runtime.getURL("popup.html"),
      },
      runtime,
    ),
    true,
  );
  assert.equal(
    isExtensionPageSender(
      {
        id: "ponmlkjihgfedcbaponmlkjihgfedcba",
        url: runtime.getURL("popup.html"),
      },
      runtime,
    ),
    false,
  );
  assert.equal(
    isExtensionPageSender(
      {
        id: runtime.id,
        url: "https://erp4.example.invalid/popup.html",
      },
      runtime,
    ),
    false,
  );
});

test("accepts only this extension content script at the exact ERP4 origin", () => {
  assert.equal(
    isExactErp4Sender(
      {
        id: runtime.id,
        origin: erp4Origin,
        url: `${erp4Origin}/knowledge?browserCapture=${"a".repeat(32)}`,
      },
      runtime,
      erp4Origin,
    ),
    true,
  );
  for (const sender of [
    {
      id: runtime.id,
      origin: "https://attacker.invalid",
      url: `${erp4Origin}/knowledge`,
    },
    {
      id: runtime.id,
      origin: erp4Origin,
      url: "https://attacker.invalid/knowledge",
    },
    {
      id: "ponmlkjihgfedcbaponmlkjihgfedcba",
      origin: erp4Origin,
      url: `${erp4Origin}/knowledge`,
    },
    {
      id: runtime.id,
      origin: erp4Origin,
      url: "not-a-url",
    },
  ]) {
    assert.equal(isExactErp4Sender(sender, runtime, erp4Origin), false);
  }
});
