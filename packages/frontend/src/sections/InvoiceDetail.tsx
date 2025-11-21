import React from 'react';

type InvoiceDetailProps = {
  id: string;
  invoiceNo?: string;
  projectId: string;
  status: string;
  totalAmount: number;
  onSend?: () => void;
};

export const InvoiceDetail: React.FC<InvoiceDetailProps> = ({ id, invoiceNo, projectId, status, totalAmount, onSend }) => {
  return (
    <div>
      <h3>請求詳細</h3>
      <div>ID: {id}</div>
      <div>No: {invoiceNo || '(draft)'}</div>
      <div>Project: {projectId}</div>
      <div>Status: {status}</div>
      <div>Amount: ¥{totalAmount.toLocaleString()}</div>
      <button className="button" onClick={onSend}>送信 (Stub)</button>
    </div>
  );
};
