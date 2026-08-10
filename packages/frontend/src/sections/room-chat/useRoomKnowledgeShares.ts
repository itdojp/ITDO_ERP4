import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getKnowledgeShareCard,
  listRoomKnowledgeShareSummaries,
  type KnowledgeShareSafeErrorCode,
} from '../knowledge-share/knowledgeShareApi';
import {
  normalizeKnowledgeShareMessageIds,
  type KnowledgeShareRoomCard,
  type RoomKnowledgeShareSummary,
} from '../knowledge-share/knowledgeShareModel';

const maximumConcurrentCardReads = 4;
const invalidRequestKey = '__invalid_room_knowledge_share_request__';
const safeErrorCodes = new Set<KnowledgeShareSafeErrorCode>([
  'external_audience_not_supported',
  'forbidden',
  'idempotency_conflict',
  'invalid_request',
  'invalid_response',
  'network_error',
  'not_found',
  'organization_confirmation_required',
  'preview_token_expired',
  'preview_token_invalid',
  'promotion_conflict',
  'request_aborted',
  'secure_request_key_unavailable',
  'share_post_failed',
  'stale_preview',
  'unauthorized',
  'unknown_error',
]);

export type RoomKnowledgeShareLoadError = Readonly<{
  code: KnowledgeShareSafeErrorCode;
  message: string;
}>;

export type RoomKnowledgeShareEntry = {
  summary: RoomKnowledgeShareSummary;
  card: KnowledgeShareRoomCard;
};

type KnowledgeShareState = {
  identity: string;
  generation: number;
  summariesByMessageId: Map<string, RoomKnowledgeShareSummary>;
  cardsByMessageId: Map<string, KnowledgeShareRoomCard>;
  loadingByMessageId: Map<string, boolean>;
  errorsByMessageId: Map<string, RoomKnowledgeShareLoadError>;
  isLoadingSummaries: boolean;
};

function safeErrorMessage(code: KnowledgeShareSafeErrorCode): string {
  switch (code) {
    case 'request_aborted':
      return '知識共有の読み込みを中止しました。';
    case 'network_error':
      return '知識共有を読み込めませんでした。通信状態を確認してください。';
    case 'unauthorized':
    case 'forbidden':
    case 'not_found':
      return 'この知識共有は表示できません。';
    case 'invalid_request':
    case 'invalid_response':
      return '知識共有の表示データを確認できませんでした。';
    default:
      return '知識共有を読み込めませんでした。';
  }
}

function sanitizeError(error: unknown): RoomKnowledgeShareLoadError {
  const candidate =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code =
    typeof candidate === 'string' &&
    safeErrorCodes.has(candidate as KnowledgeShareSafeErrorCode)
      ? (candidate as KnowledgeShareSafeErrorCode)
      : 'unknown_error';
  return Object.freeze({ code, message: safeErrorMessage(code) });
}

function invalidResponseError(): RoomKnowledgeShareLoadError {
  return Object.freeze({
    code: 'invalid_response',
    message: safeErrorMessage('invalid_response'),
  });
}

function isAccessLoss(error: RoomKnowledgeShareLoadError) {
  return (
    error.code === 'unauthorized' ||
    error.code === 'forbidden' ||
    error.code === 'not_found'
  );
}

function initialState(
  identity: string,
  generation: number,
  messageIds: readonly string[],
  loading: boolean,
): KnowledgeShareState {
  return {
    identity,
    generation,
    summariesByMessageId: new Map(),
    cardsByMessageId: new Map(),
    loadingByMessageId: new Map(
      messageIds.map((messageId) => [messageId, loading]),
    ),
    errorsByMessageId: new Map(),
    isLoadingSummaries: loading,
  };
}

function failedState(
  identity: string,
  generation: number,
  messageIds: readonly string[],
  error: RoomKnowledgeShareLoadError,
): KnowledgeShareState {
  return {
    ...initialState(identity, generation, messageIds, false),
    errorsByMessageId: new Map(
      messageIds.map((messageId) => [messageId, error]),
    ),
  };
}

/**
 * Resolves Knowledge Share cards only for the exact root messages currently
 * visible in one room. Card content and transient errors remain in memory.
 */
export function useRoomKnowledgeShares(input: {
  roomId: string;
  visibleRootMessageIds?: readonly string[];
  /** Compatibility alias for callers prepared before the integration slice. */
  rootMessageIds?: readonly string[];
  hasAccess?: boolean;
}) {
  const {
    roomId,
    visibleRootMessageIds,
    rootMessageIds,
    hasAccess = true,
  } = input;
  const suppliedMessageIds = visibleRootMessageIds ?? rootMessageIds ?? [];
  const normalizedMessageIds =
    suppliedMessageIds.length === 0
      ? []
      : normalizeKnowledgeShareMessageIds(suppliedMessageIds);
  const requestKey = normalizedMessageIds
    ? JSON.stringify(normalizedMessageIds)
    : invalidRequestKey;
  const identity = JSON.stringify([roomId, requestKey]);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<KnowledgeShareState>(() =>
    initialState(identity, 0, [], false),
  );

  const purgeKnowledgeShares = useCallback(
    (targetRoomId?: string) => {
      if (targetRoomId && targetRoomId !== roomId) return false;
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setState(initialState(identity, generationRef.current, [], false));
      return true;
    },
    [identity, roomId],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    abortRef.current?.abort();
    abortRef.current = null;

    if (
      !hasAccess ||
      !roomId ||
      requestKey === invalidRequestKey ||
      requestKey === '[]'
    ) {
      const invalidIds =
        hasAccess && requestKey === invalidRequestKey ? suppliedMessageIds : [];
      setState(
        invalidIds.length > 0
          ? failedState(
              identity,
              generation,
              invalidIds,
              Object.freeze({
                code: 'invalid_request',
                message: safeErrorMessage('invalid_request'),
              }),
            )
          : initialState(identity, generation, [], false),
      );
      return;
    }

    const messageIds = JSON.parse(requestKey) as string[];
    const controller = new AbortController();
    abortRef.current = controller;
    setState(initialState(identity, generation, messageIds, true));

    const isCurrent = () =>
      generationRef.current === generation && !controller.signal.aborted;

    const purgeAfterAccessLoss = (error: RoomKnowledgeShareLoadError) => {
      if (!isCurrent()) return;
      generationRef.current += 1;
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
      setState(failedState(identity, generationRef.current, messageIds, error));
    };

    const load = async () => {
      let summaries: RoomKnowledgeShareSummary[];
      try {
        summaries = await listRoomKnowledgeShareSummaries({
          roomId,
          messageIds,
          signal: controller.signal,
        });
      } catch (error) {
        if (!isCurrent()) return;
        const safeError = sanitizeError(error);
        if (safeError.code === 'request_aborted') return;
        if (isAccessLoss(safeError)) {
          purgeAfterAccessLoss(safeError);
          return;
        }
        setState(failedState(identity, generation, messageIds, safeError));
        return;
      }

      if (!isCurrent()) return;
      const summariesByMessageId = new Map(
        summaries.map((summary) => [summary.messageId, summary]),
      );
      const matchedSummaries = messageIds
        .map((messageId) => summariesByMessageId.get(messageId))
        .filter(
          (summary): summary is RoomKnowledgeShareSummary =>
            summary !== undefined,
        );
      setState({
        identity,
        generation,
        summariesByMessageId,
        cardsByMessageId: new Map(),
        loadingByMessageId: new Map(
          messageIds.map((messageId) => [
            messageId,
            summariesByMessageId.has(messageId),
          ]),
        ),
        errorsByMessageId: new Map(),
        isLoadingSummaries: false,
      });

      let nextIndex = 0;
      const readNextCard = async (): Promise<void> => {
        while (isCurrent()) {
          const summary = matchedSummaries[nextIndex];
          nextIndex += 1;
          if (!summary) return;

          try {
            const card = await getKnowledgeShareCard(summary.messageId, {
              signal: controller.signal,
            });
            if (!isCurrent()) return;
            if (
              card.shareId !== summary.shareId ||
              card.schemaVersion !== summary.schemaVersion ||
              card.version < summary.version ||
              (card.version === summary.version &&
                card.status !== summary.status) ||
              (summary.status === 'revoked' && card.status !== 'revoked')
            ) {
              const safeError = invalidResponseError();
              setState((current) => {
                if (
                  current.identity !== identity ||
                  current.generation !== generation
                ) {
                  return current;
                }
                const cardsByMessageId = new Map(current.cardsByMessageId);
                const loadingByMessageId = new Map(current.loadingByMessageId);
                const errorsByMessageId = new Map(current.errorsByMessageId);
                cardsByMessageId.delete(summary.messageId);
                loadingByMessageId.set(summary.messageId, false);
                errorsByMessageId.set(summary.messageId, safeError);
                return {
                  ...current,
                  cardsByMessageId,
                  loadingByMessageId,
                  errorsByMessageId,
                };
              });
              continue;
            }

            setState((current) => {
              if (
                current.identity !== identity ||
                current.generation !== generation
              ) {
                return current;
              }
              const existing = current.cardsByMessageId.get(summary.messageId);
              const loadingByMessageId = new Map(current.loadingByMessageId);
              loadingByMessageId.set(summary.messageId, false);
              if (existing && existing.version > card.version) {
                return { ...current, loadingByMessageId };
              }
              const cardsByMessageId = new Map(current.cardsByMessageId);
              const nextSummaries = new Map(current.summariesByMessageId);
              const errorsByMessageId = new Map(current.errorsByMessageId);
              cardsByMessageId.set(summary.messageId, card);
              nextSummaries.set(summary.messageId, {
                ...summary,
                status: card.status,
                version: card.version,
              });
              errorsByMessageId.delete(summary.messageId);
              return {
                ...current,
                summariesByMessageId: nextSummaries,
                cardsByMessageId,
                loadingByMessageId,
                errorsByMessageId,
              };
            });
          } catch (error) {
            if (!isCurrent()) return;
            const safeError = sanitizeError(error);
            if (safeError.code === 'request_aborted') return;
            if (isAccessLoss(safeError)) {
              purgeAfterAccessLoss(safeError);
              return;
            }
            setState((current) => {
              if (
                current.identity !== identity ||
                current.generation !== generation
              ) {
                return current;
              }
              const cardsByMessageId = new Map(current.cardsByMessageId);
              const loadingByMessageId = new Map(current.loadingByMessageId);
              const errorsByMessageId = new Map(current.errorsByMessageId);
              cardsByMessageId.delete(summary.messageId);
              loadingByMessageId.set(summary.messageId, false);
              errorsByMessageId.set(summary.messageId, safeError);
              return {
                ...current,
                cardsByMessageId,
                loadingByMessageId,
                errorsByMessageId,
              };
            });
          }
        }
      };

      await Promise.all(
        Array.from(
          {
            length: Math.min(
              maximumConcurrentCardReads,
              matchedSummaries.length,
            ),
          },
          () => readNextCard(),
        ),
      );
    };

    void load();
    return () => {
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
      if (generationRef.current === generation) generationRef.current += 1;
    };
    // requestKey is the stable serialized form of the exact supplied ID set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess, identity, requestKey, roomId]);

  return useMemo(() => {
    const visibleState =
      hasAccess && state.identity === identity ? state : null;
    const summariesByMessageId = new Map(
      visibleState?.summariesByMessageId ??
        new Map<string, RoomKnowledgeShareSummary>(),
    );
    const cardsByMessageId = new Map(
      visibleState?.cardsByMessageId ??
        new Map<string, KnowledgeShareRoomCard>(),
    );
    const loadingByMessageId = new Map(
      visibleState?.loadingByMessageId ?? new Map<string, boolean>(),
    );
    const errorsByMessageId = new Map(
      visibleState?.errorsByMessageId ??
        new Map<string, RoomKnowledgeShareLoadError>(),
    );
    const knowledgeShares = new Map<string, RoomKnowledgeShareEntry>();
    for (const [messageId, card] of cardsByMessageId) {
      const summary = summariesByMessageId.get(messageId);
      if (summary) knowledgeShares.set(messageId, { summary, card });
    }
    return {
      summariesByMessageId: summariesByMessageId as ReadonlyMap<
        string,
        RoomKnowledgeShareSummary
      >,
      cardsByMessageId: cardsByMessageId as ReadonlyMap<
        string,
        KnowledgeShareRoomCard
      >,
      loadingByMessageId: loadingByMessageId as ReadonlyMap<string, boolean>,
      errorsByMessageId: errorsByMessageId as ReadonlyMap<
        string,
        RoomKnowledgeShareLoadError
      >,
      isLoadingSummaries: visibleState?.isLoadingSummaries ?? false,
      knowledgeShares: knowledgeShares as ReadonlyMap<
        string,
        RoomKnowledgeShareEntry
      >,
      isLoading:
        visibleState?.isLoadingSummaries === true ||
        [...loadingByMessageId.values()].some(Boolean),
      purgeKnowledgeShares,
    };
  }, [hasAccess, identity, purgeKnowledgeShares, state]);
}
