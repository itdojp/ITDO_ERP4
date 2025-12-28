import React from 'react';
import { Dashboard } from '../sections/Dashboard';
import { DailyReport } from '../sections/DailyReport';
import { TimeEntries } from '../sections/TimeEntries';
import { Invoices } from '../sections/Invoices';
import { Expenses } from '../sections/Expenses';
import { HRAnalytics } from '../sections/HRAnalytics';
import { CurrentUser } from '../sections/CurrentUser';
import { Reports } from '../sections/Reports';
import { AdminSettings } from '../sections/AdminSettings';
import { ProjectChat } from '../sections/ProjectChat';

export const App: React.FC = () => {
  return (
    <div className="container">
      <h1>ERP4 MVP PoC</h1>
      <CurrentUser />
      <div className="card"><Dashboard /></div>
      <div className="card"><DailyReport /></div>
      <div className="card"><TimeEntries /></div>
      <div className="card"><Expenses /></div>
      <div className="card"><Invoices /></div>
      <div className="card"><Reports /></div>
      <div className="card"><AdminSettings /></div>
      <div className="card"><ProjectChat /></div>
      <div className="card"><HRAnalytics /></div>
    </div>
  );
};
