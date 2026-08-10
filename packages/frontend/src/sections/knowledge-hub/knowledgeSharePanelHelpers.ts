import type { ChatRoom } from '../room-chat/roomChatModel';
import type { KnowledgeSynthesisDetail } from './knowledgeProvenanceModel';

export function mergeKnowledgeShareCandidates<T extends { id: string }>(
  current: T[],
  incoming: T[],
) {
  const merged = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) merged.set(entry.id, entry);
  return [...merged.values()];
}

export function mergeKnowledgeShareSynthesisDetails(
  current: KnowledgeSynthesisDetail[],
  incoming: KnowledgeSynthesisDetail[],
) {
  const merged = new Map(
    current.map((detail) => [detail.synthesis.id, detail]),
  );
  for (const detail of incoming) merged.set(detail.synthesis.id, detail);
  return [...merged.values()];
}

export function knowledgeShareRoomDisplayLabel(room: ChatRoom, index: number) {
  if (room.type === 'project') {
    if (room.projectCode && room.projectName) {
      return `${room.projectCode} / ${room.projectName}`;
    }
    if (room.projectCode) return room.projectCode;
  }
  if (room.type === 'dm') return `ダイレクトメッセージ ${index + 1}`;
  const name = room.name.trim();
  return name || `Chat room ${index + 1}`;
}

export function hasUnsafeKnowledgeShareNoteCharacter(value: string) {
  const directional = new Set([
    0x061c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d,
    0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
  ]);
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      directional.has(codePoint)
    ) {
      return true;
    }
  }
  return false;
}
