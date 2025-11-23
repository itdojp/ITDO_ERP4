import React from 'react';

type InvoiceDetailProps = {
  id: string;
  invoiceNo?: string;
  projectId: string;
  status: string;
  totalAmount: number;
  lines?: { description: string; quantity: number; unitPrice: number }[];
  approval?: { step: number; total: number; status: string };
  onSend?: () => void;
};

export const InvoiceDetail: React.FC<InvoiceDetailProps> = ({ id, invoiceNo, projectId, status, totalAmount, lines = [], approval, onSend }) => {
  return (
    <div>
      <h3>請求詳細</h3>
      <div>ID: {id}</div>
      <div>No: {invoiceNo || '(draft)'}</div>
      <div>Project: {projectId}</div>
      <div>Status: {status}</div>
      <div>Amount: ¥{totalAmount.toLocaleString()}</div>
      {lines.length > 0 && (
        <table className="table" style={{ width: '100%', marginTop: 8 }}>
          <thead>
            <tr>
              <th>明細</th>
              <th>数量</th>
              <th>単価</th>
              <th>小計</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td>{l.description}</td>
                <td>{l.quantity}</td>
                <td>¥{l.unitPrice.toLocaleString()}</td>
                <td>¥{(l.quantity * l.unitPrice).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {approval && (
        <div style={{ marginTop: 8, fontSize: 14 }}>
          承認 {approval.step}/{approval.total} : {approval.status}
        </div>
      )}
      <button className="button" onClick={onSend}>送信 (Stub)</button>
    </div>
  );
};
