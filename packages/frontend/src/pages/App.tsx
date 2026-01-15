import React from 'react';
import { Card } from '../ui';
import { Dashboard } from '../sections/Dashboard';
import { GlobalSearch } from '../sections/GlobalSearch';
import { DailyReport } from '../sections/DailyReport';
import { TimeEntries } from '../sections/TimeEntries';
import { ProjectTasks } from '../sections/ProjectTasks';
import { Estimates } from '../sections/Estimates';
import { Invoices } from '../sections/Invoices';
import { Expenses } from '../sections/Expenses';
import { LeaveRequests } from '../sections/LeaveRequests';
import { HRAnalytics } from '../sections/HRAnalytics';
import { CurrentUser } from '../sections/CurrentUser';
import { Reports } from '../sections/Reports';
import { AdminSettings } from '../sections/AdminSettings';
import { Approvals } from '../sections/Approvals';
import { ProjectChat } from '../sections/ProjectChat';
import { RoomChat } from '../sections/RoomChat';
import { ChatBreakGlass } from '../sections/ChatBreakGlass';
import { MasterData } from '../sections/MasterData';
import { Projects } from '../sections/Projects';
import { ProjectMilestones } from '../sections/ProjectMilestones';
import { VendorDocuments } from '../sections/VendorDocuments';
import { AccessReviews } from '../sections/AccessReviews';
import { AuditLogs } from '../sections/AuditLogs';
import { PeriodLocks } from '../sections/PeriodLocks';
import { AdminJobs } from '../sections/AdminJobs';

export const App: React.FC = () => {
  return (
    <div className="container">
      <h1>ERP4 MVP PoC</h1>
      <CurrentUser />
      <Card>
        <Dashboard />
      </Card>
      <Card>
        <GlobalSearch />
      </Card>
      <Card>
        <DailyReport />
      </Card>
      <Card>
        <TimeEntries />
      </Card>
      <Card>
        <ProjectTasks />
      </Card>
      <Card>
        <Expenses />
      </Card>
      <Card>
        <LeaveRequests />
      </Card>
      <Card>
        <Estimates />
      </Card>
      <Card>
        <Invoices />
      </Card>
      <Card>
        <VendorDocuments />
      </Card>
      <Card>
        <Reports />
      </Card>
      <Card>
        <Approvals />
      </Card>
      <Card>
        <ChatBreakGlass />
      </Card>
      <Card>
        <Projects />
      </Card>
      <Card>
        <ProjectMilestones />
      </Card>
      <Card>
        <MasterData />
      </Card>
      <Card>
        <AdminSettings />
      </Card>
      <Card>
        <AdminJobs />
      </Card>
      <Card>
        <AccessReviews />
      </Card>
      <Card>
        <AuditLogs />
      </Card>
      <Card>
        <PeriodLocks />
      </Card>
      <Card>
        <ProjectChat />
      </Card>
      <Card>
        <RoomChat />
      </Card>
      <Card>
        <HRAnalytics />
      </Card>
    </div>
  );
};
