import { ERP4_CAPTURE_ORIGIN } from "./config.js";
import {
  captureFields,
  defaultSelectedFields,
  normalizeCaptureDraft,
  normalizeExtractedCapture,
  prepareCaptureStageIntent,
} from "./capture-contract.js";

const labels = {
  title: "ページタイトル",
  url: "URL",
  selectedText: "選択テキスト",
  description: "説明",
  author: "著者",
  publishedAt: "公開日時",
};

const state = {
  draft: null,
  selectedFields: [],
  stagedId: "",
  stageIntent: null,
  isStaging: false,
};

const byId = (id) => document.getElementById(id);
const status = byId("status");
const fields = byId("fields");
const handoff = byId("handoff");
const recapture = byId("recapture");
const discard = byId("discard");
const destination = byId("destination");

function setStatus(message, tone = "info") {
  status.textContent = message;
  status.dataset.tone = tone;
}

function captureInputsLocked() {
  return (
    state.isStaging || state.stageIntent !== null || state.stagedId.length > 0
  );
}

function render() {
  const inputsLocked = captureInputsLocked();
  fields.replaceChildren();
  recapture.disabled = inputsLocked;
  if (!state.draft) {
    handoff.disabled = true;
    discard.disabled = !state.stagedId;
    return;
  }
  for (const field of captureFields) {
    const value = state.draft[field];
    const row = document.createElement("label");
    row.className = "field";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedFields.includes(field);
    checkbox.disabled = inputsLocked || value === null;
    checkbox.addEventListener("change", () => {
      if (captureInputsLocked()) {
        checkbox.checked = state.selectedFields.includes(field);
        return;
      }
      state.stageIntent = null;
      state.selectedFields = checkbox.checked
        ? [...state.selectedFields, field]
        : state.selectedFields.filter((candidate) => candidate !== field);
      handoff.disabled = state.selectedFields.length === 0;
    });
    const text = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = labels[field];
    const preview = document.createElement("span");
    preview.className = "preview";
    preview.textContent = value ?? "取得なし";
    text.append(label, preview);
    row.append(checkbox, text);
    fields.append(row);
  }
  handoff.disabled = state.isStaging || state.selectedFields.length === 0;
  discard.disabled = !state.stagedId;
}

async function captureCurrentTab() {
  if (captureInputsLocked()) throw new Error("capture_locked");
  setStatus("表示中ページを取得しています。");
  state.stagedId = "";
  state.stageIntent = null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("active_tab_unavailable");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [0] },
    files: ["capture-page.js"],
  });
  const draft = normalizeExtractedCapture(result[0]?.result);
  if (!draft) throw new Error("capture_payload_invalid");
  state.draft = draft;
  state.selectedFields = defaultSelectedFields(draft);
  setStatus("取得fieldを確認し、ERP4での確認へ進んでください。");
  render();
}

async function openErp4(id) {
  await chrome.tabs.create({
    url: `${ERP4_CAPTURE_ORIGIN}/?browserCapture=${encodeURIComponent(id)}`,
  });
  setStatus(
    "ERP4を開きました。draftはbrowser session内で10分間だけ読取可能です。開けない場合は利用者操作で再試行してください。",
  );
}

async function stageAndOpen() {
  if (state.isStaging || !state.draft || state.selectedFields.length === 0) {
    return;
  }
  state.isStaging = true;
  render();
  try {
    if (!state.stagedId) {
      state.stageIntent = prepareCaptureStageIntent(
        state.draft,
        state.selectedFields,
        state.stageIntent,
      );
      if (!state.stageIntent) throw new Error("capture_selection_invalid");
      const response = await chrome.runtime.sendMessage({
        type: "erp4-browser-capture-stage-v1",
        ...state.stageIntent,
      });
      if (!response?.ok || !response.record?.id) {
        if (response?.ok === false) state.stageIntent = null;
        throw new Error(response?.code ?? "storage_unavailable");
      }
      state.stagedId = response.record.id;
      state.draft = normalizeCaptureDraft(response.record.draft);
      if (!state.draft) throw new Error("storage_unavailable");
      state.stageIntent = null;
    }
    await openErp4(state.stagedId);
  } catch (error) {
    setStatus(
      error instanceof Error && error.message === "queue_full"
        ? "保留draftが上限です。既存draftを確認または破棄してください。"
        : "handoffを開始できませんでした。自動再送していません。",
      "error",
    );
  } finally {
    state.isStaging = false;
    render();
  }
}

async function loadRecent() {
  destination.textContent = ERP4_CAPTURE_ORIGIN;
  const response = await chrome.runtime.sendMessage({
    type: "erp4-browser-capture-recent-v1",
  });
  const draft = normalizeCaptureDraft(response?.record?.draft);
  if (response?.ok && response.record?.id && draft) {
    state.stagedId = response.record.id;
    state.stageIntent = null;
    state.draft = draft;
    state.selectedFields = captureFields.filter(
      (field) => draft[field] !== null,
    );
    setStatus("未完了のsession draftがあります。再確認または破棄できます。");
    render();
    return;
  }
  await captureCurrentTab();
}

handoff.addEventListener("click", () => void stageAndOpen());
recapture.addEventListener("click", () => {
  if (state.stagedId) {
    setStatus("保留draftを先に破棄してください。", "error");
    return;
  }
  void captureCurrentTab().catch(() => {
    setStatus("このページから安全なfieldを取得できません。", "error");
  });
});
discard.addEventListener("click", () => {
  const id = state.stagedId;
  if (!id) return;
  void chrome.runtime
    .sendMessage({
      type: "erp4-browser-capture-discard-unclaimed-v1",
      id,
    })
    .then((response) => {
      if (!response?.ok) throw new Error("discard_failed");
      state.stagedId = "";
      state.stageIntent = null;
      state.draft = null;
      state.selectedFields = [];
      setStatus("draftを破棄しました。");
      render();
    })
    .catch(() => setStatus("draftを破棄できませんでした。", "error"));
});

void loadRecent().catch(() => {
  setStatus("このページから安全なfieldを取得できません。", "error");
});
