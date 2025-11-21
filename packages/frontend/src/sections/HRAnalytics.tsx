import React from 'react';

const demoGroups = [
  { name: 'Team A', members: 8, notGood: 0.25, stress: 2.1, engagement: 3.2 },
  { name: 'Team B', members: 3, notGood: 0.3, stress: 2.5, engagement: 3.0 },
];

export const HRAnalytics: React.FC = () => {
  const filtered = demoGroups.filter((g) => g.members >= 5);
  return (
    <div>
      <h2>匿名集計（人事向け）</h2>
      <p className="badge">5人未満は非表示</p>
      <ul className="list">
        {filtered.map((g) => (
          <li key={g.name}>
            <strong>{g.name}</strong> ({g.members}人)
            <div>Not Good: {(g.notGood * 100).toFixed(1)}% / ストレス平均: {g.stress} / 充実感平均: {g.engagement}</div>
          </li>
        ))}
        {filtered.length === 0 && <li>表示可能なデータなし</li>}
      </ul>
      <p style={{ fontSize: 12, color: '#475569' }}>個人特定を避けるため5人未満は表示しません。評価目的での利用は禁止。</p>
    </div>
  );
};
