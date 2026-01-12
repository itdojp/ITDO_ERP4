import React, { useState } from 'react';

const options = [
  {
    key: 'manager',
    label: '上長に相談',
    target: 'manager_group',
    eta: '2営業日',
  },
  { key: 'hr', label: '人事・労務に相談', target: 'hr_group', eta: '2営業日' },
  {
    key: 'health',
    label: '産業医/保健スタッフ',
    target: 'health_team',
    eta: '3営業日',
    optional: true,
  },
  {
    key: 'eap',
    label: '社外相談窓口（EAP等）',
    target: 'external',
    eta: '外部窓口',
  },
  {
    key: 'emergency',
    label: '緊急の支援が必要かもしれない',
    target: 'public_hotline',
    eta: '至急',
  },
];

export const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 20,
          borderRadius: 12,
          width: 420,
        }}
      >
        <h3>ヘルプ / 相談</h3>
        <p style={{ fontSize: 12, color: '#475569' }}>
          相談先を選択してください（複数選択可）。通知先と目安時間を表示します。
        </p>
        <ul className="list">
          {options.map((o) => (
            <li key={o.key}>
              <label
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.key)}
                  onChange={() => toggle(o.key)}
                />
                <div>
                  <div>
                    <strong>{o.label}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    通知先: {o.target} / 目安: {o.eta}
                  </div>
                </div>
              </label>
            </li>
          ))}
        </ul>
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>
          緊急の状態では、ただちに医療機関や公的相談窓口に連絡してください。
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="button secondary" onClick={onClose}>
            閉じる
          </button>
          <button
            className="button"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
          >
            送信 (Stub)
          </button>
        </div>
      </div>
    </div>
  );
};
