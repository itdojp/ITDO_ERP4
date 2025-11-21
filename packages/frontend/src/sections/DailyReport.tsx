import React, { useState } from 'react';
import { api } from '../api';
import { HelpModal } from './HelpModal';

const tags = ['仕事量が多い', '役割/進め方', '人間関係', '体調', '私生活', '特になし'];

export const DailyReport: React.FC = () => {
  const [status, setStatus] = useState<'good' | 'not_good' | ''>('');
  const [notes, setNotes] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [helpRequested, setHelpRequested] = useState(false);
  const [message, setMessage] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const submit = async () => {
    try {
      await api('/daily-reports', {
        method: 'POST',
        body: JSON.stringify({ content: '日報本文', reportDate: new Date().toISOString(), linkedProjectIds: [], status: 'submitted' }),
      });
      await api('/wellbeing-entries', {
        method: 'POST',
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          status,
          notes: selectedTags.length ? `${notes}\nTags:${selectedTags.join(',')}` : notes,
          helpRequested,
          visibilityGroupId: 'hr-group',
        }),
      });
      setMessage('送信しました');
    } catch (e) {
      setMessage('送信に失敗しました');
    }
  };

  return (
    <div>
      <h2>日報 + ウェルビーイング</h2>
      <div className="row" style={{ alignItems: 'center' }}>
        <span>今日のコンディション:</span>
        <button className="button secondary" onClick={() => setStatus('good')} aria-pressed={status === 'good'}>Good</button>
        <button className="button secondary" onClick={() => setStatus('not_good')} aria-pressed={status === 'not_good'}>Not Good</button>
        <button className="button" style={{ marginLeft: 'auto' }} onClick={() => setShowHelp(true)}>ヘルプ / 相談したい</button>
      </div>
      {status === 'not_good' && (
        <div style={{ marginTop: 12 }}>
          <div>タグ（任意）</div>
          <div className="row">
            {tags.map((tag) => (
              <button
                key={tag}
                className="button secondary"
                onClick={() => toggleTag(tag)}
                aria-pressed={selectedTags.includes(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <textarea
              placeholder="共有してもよければ、今日しんどかったことを書いてください（空欄可）"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: '100%', minHeight: 80 }}
            />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input type="checkbox" checked={helpRequested} onChange={(e) => setHelpRequested(e.target.checked)} />
            相談したい（人事/相談窓口へ）
          </label>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button className="button" onClick={submit}>送信</button>
      </div>
      {message && <p>{message}</p>}
      <p style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>
        この入力は評価に使われません。職場環境の改善とサポートのためにのみ利用します。
      </p>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
};
