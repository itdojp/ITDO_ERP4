import {
  defaultStatusFallbackLabelFormatter,
  type StatusDictionary,
} from '@itdo/design-system';

export const erpStatusDictionary: StatusDictionary = {
  draft: { label: '下書き', tone: 'neutral' },
  submitted: { label: '申請済み', tone: 'info' },
  pending_qa: { label: '一次承認待ち', tone: 'warning' },
  pending_exec: { label: '最終承認待ち', tone: 'warning' },
  approved: { label: '承認済み', tone: 'success' },
  rejected: { label: '却下', tone: 'danger' },
  sent: { label: '送信済み', tone: 'info' },
  paid: { label: '入金済み', tone: 'success' },
  received: { label: '受領', tone: 'info' },
  active: { label: '有効', tone: 'success' },
  inactive: { label: '無効', tone: 'neutral' },
  disabled: { label: '停止中', tone: 'neutral' },
  failed: { label: '失敗', tone: 'danger' },
  done: { label: '完了', tone: 'success' },
  cancelled: { label: '取消', tone: 'neutral' },
};

export function formatErpStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  const entry = erpStatusDictionary[normalized];
  if (entry) return entry.label;
  return defaultStatusFallbackLabelFormatter(status);
}
