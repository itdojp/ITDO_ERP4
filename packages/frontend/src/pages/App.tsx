import React from 'react';
import { Dashboard } from '../sections/Dashboard';
import { DailyReport } from '../sections/DailyReport';
import { TimeEntries } from '../sections/TimeEntries';
import { Invoices } from '../sections/Invoices';
import { HRAnalytics } from '../sections/HRAnalytics';

export const App: React.FC = () => {
  return (
    <div className="container">
      <h1>ERP4 MVP PoC</h1>
      <div className="card"><Dashboard /></div>
      <div className="card"><DailyReport /></div>
      <div className="card"><TimeEntries /></div>
      <div className="card"><Invoices /></div>
      <div className="card"><HRAnalytics /></div>
    </div>
  );
};
