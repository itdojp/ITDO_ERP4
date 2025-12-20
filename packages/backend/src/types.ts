export type WithUser<T> = T & { userId: string; roles: string[] };

export function requireRole(userRoles: string[], allowed: string[]) {
  return allowed.some((r) => userRoles.includes(r));
}

export type DocStatus =
  | 'draft'
  | 'pending_qa'
  | 'pending_exec'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'paid'
  | 'cancelled'
  | 'received'
  | 'acknowledged';
export const DocStatusValue: Record<DocStatus, DocStatus> = {
  draft: 'draft',
  pending_qa: 'pending_qa',
  pending_exec: 'pending_exec',
  approved: 'approved',
  rejected: 'rejected',
  sent: 'sent',
  paid: 'paid',
  cancelled: 'cancelled',
  received: 'received',
  acknowledged: 'acknowledged',
};

export type TimeStatus = 'submitted' | 'approved' | 'rejected';
export const TimeStatusValue: Record<TimeStatus, TimeStatus> = {
  submitted: 'submitted',
  approved: 'approved',
  rejected: 'rejected',
};

export type FlowType =
  | 'estimate'
  | 'invoice'
  | 'expense'
  | 'leave'
  | 'time'
  | 'purchase_order'
  | 'vendor_invoice'
  | 'vendor_quote';
export const FlowTypeValue: Record<FlowType, FlowType> = {
  estimate: 'estimate',
  invoice: 'invoice',
  expense: 'expense',
  leave: 'leave',
  time: 'time',
  purchase_order: 'purchase_order',
  vendor_invoice: 'vendor_invoice',
  vendor_quote: 'vendor_quote',
};

export type AlertType = 'budget_overrun' | 'overtime' | 'approval_delay' | 'delivery_due';
export const AlertTypeValue: Record<AlertType, AlertType> = {
  budget_overrun: 'budget_overrun',
  overtime: 'overtime',
  approval_delay: 'approval_delay',
  delivery_due: 'delivery_due',
};
