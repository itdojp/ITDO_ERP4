// Canonical backend architectural classification registry.
//
// `contexts` are used by dependency-cruiser to enforce bounded-context import
// direction. `layers` classify route/service files that are intentionally not a
// bounded context, while still making coverage explicit and reviewable.
// Keep patterns current: the coverage checker fails stale or overlapping
// bounded-context patterns.

const contexts = [
  {
    name: 'identity-access',
    displayName: 'Identity & Access',
    patterns: [
      '^src/plugins/auth\\.ts$',
      '^src/application/auth/.+\\.ts$',
      '^src/routes/(accessReviews|auth|groups|scim)\\.ts$',
      '^src/routes/auth/.+\\.ts$',
      '^src/services/(authContext|authGateway|groupCandidates|localCredentials|rateLimitOverrides|rbac)\\.ts$',
      '^src/utils/authGroupToRoleMap\\.ts$',
    ],
  },
  {
    name: 'org-project',
    displayName: 'Org & Project',
    patterns: [
      '^src/routes/projects\\.ts$',
      '^src/services/(entityChecks|taskDependencyGraph)\\.ts$',
    ],
  },
  {
    name: 'master-data',
    displayName: 'Master Data',
    patterns: [
      '^src/routes/(contacts|customers|rateCards|vendors)\\.ts$',
      '^src/services/(rateCard)\\.ts$',
    ],
  },
  {
    name: 'documents',
    displayName: 'Documents',
    patterns: [
      '^src/routes/(dailyReports|drafts|estimates|expenses|invoices|leave|leaveEntitlements|leaveSettings|leaveWorkdayCalendar|purchaseOrders|send|timeEntries|vendorDocs|worklogSettings)\\.ts$',
      '^src/services/(expenseBudget|expenseQaChecklist|expenseStateTransitionLog|leaveCompGrants|leaveEntitlements|leaveSettings|leaveTypes|leaveUpcomingNotifications|leaveWorkdayCalendar|numbering|recurring|vendorInvoiceAllocations|vendorInvoiceLineReconciliation|vendorInvoiceLines|worklogSetting)\\.ts$',
    ],
  },
  {
    name: 'workflow',
    displayName: 'Workflow',
    patterns: [
      '^src/routes/(actionPolicies|approvalRules|periodLocks)\\.ts$',
      '^src/services/(actionPolicy|actionPolicyAudit|actionPolicyErrors|approval|approvalDefaultRules|approvalEvidenceGate|approvalLogic|periodLock|reassignmentLog)\\.ts$',
    ],
  },
  {
    name: 'evidence-references',
    displayName: 'Evidence & References',
    patterns: [
      '^src/routes/(annotationSettings|annotations|evidenceSnapshots)\\.ts$',
      '^src/services/(annotationReferences|evidencePackArchive|evidencePackExport|evidenceSnapshot)\\.ts$',
    ],
  },
  {
    name: 'chat',
    displayName: 'Chat',
    patterns: [
      '^src/routes/chat[^/]*\\.ts$',
      '^src/routes/chat/.+\\.ts$',
      '^src/routes/chatRooms/.+\\.ts$',
      '^src/services/(chatAckCandidates|chatAckLimits|chatAckLinkTargets|chatAckNotifications|chatAckRecipients|chatAckReminders|chatAckTemplates|chatAttachmentScan|chatAttachments|chatExternalLlm|chatMentionCandidates|chatMentionRecipients|chatReadState|chatRoomAccess|chatRoomAclAlerts|chatRoomLifecycle|chatRoomMembership|chatRoomProvisioning|personalGaChatRoom)\\.ts$',
    ],
  },
  {
    name: 'notifications',
    displayName: 'Notifications',
    patterns: [
      '^src/routes/(alertSettings|alerts|notificationJobs|notifications|push)\\.ts$',
      '^src/services/(alert|appNotifications|notificationDeliveries|notificationPushes)\\.ts$',
    ],
  },
  {
    name: 'integrations',
    displayName: 'Integrations',
    patterns: [
      '^src/routes/integrations\\.ts$',
      '^src/services/(accountingIcsExport|accountingMappingRules|attendanceClosings|integrationExportJobs|integrationExports|integrationLeaveExports|integrationReconciliation|integrationRuns|statutoryAccountingActuals)\\.ts$',
    ],
  },
  {
    name: 'ops',
    displayName: 'Ops',
    patterns: [
      '^src/index\\.ts$',
      '^src/server\\.ts$',
      '^src/plugins/agentRuns\\.ts$',
      '^src/routes/(agent360|agentRuns|auditLogs|dataQualityJobs|metricsJobs)\\.ts$',
      '^src/services/(agentRuns|dataQuality|metrics)\\.ts$',
    ],
  },
];

const layers = [
  {
    name: 'application-orchestration',
    kind: 'application-orchestration',
    displayName: 'Application orchestration',
    rationale:
      'HTTP aggregation, cross-context read models, reports, dispatch/event entry points, or glue code that coordinates bounded contexts without defining a bounded context itself.',
    patterns: [
      '^src/application/expenses/.+\\.ts$',
      '^src/application/chat/.+\\.ts$',
      '^src/application/projects/.+\\.ts$',
      '^src/routes/(index|insights|recurringJobs|refCandidates|reportSubscriptions|reports|search|sendEvents|testHooks|wellbeing)\\.ts$',
      '^src/services/(accountingEvents|approvalEscalation|dailyReportMissing|leaveEntitlementReminders|reports)\\.ts$',
    ],
  },
  {
    name: 'shared-kernel',
    kind: 'shared-kernel',
    displayName: 'Shared kernel / pure utility',
    rationale:
      'Pure validation schemas, type helpers, date/CSV helpers, numeric/rate helpers, and policy text helpers shared across contexts.',
    patterns: [
      '^src/migration/(csv|legacyIds)\\.ts$',
      '^src/routes/validators(\\.ts|/.+\\.ts)$',
      '^src/services/(dueDateRule|errors|policyEnforcementPreset|rate|redaction|utils)\\.ts$',
      '^src/utils/(csv|date)\\.ts$',
    ],
  },
  {
    name: 'infrastructure',
    kind: 'infrastructure',
    displayName: 'Infrastructure adapters',
    rationale:
      'Database, audit, readiness, PDF, outbound notification transports, safe HTTP, and environment/runtime adapters used by multiple contexts.',
    patterns: [
      '^src/adapters/notifications/.+\\.ts$',
      '^src/routes/(pdfFiles|pdfTemplates|templateSettings)\\.ts$',
      '^src/services/(audit|db|envValidation|notifier|pdf|pdfTemplates|readiness|safeHttpClient|webPush)\\.ts$',
    ],
  },
  {
    name: 'explicit-type-exclusion',
    kind: 'excluded',
    displayName: 'Explicit non-runtime type exclusion',
    reason:
      'Top-level type declarations are intentionally outside route/service bounded-context coverage; importing them must not create a domain-direction edge.',
    patterns: ['^src/types\\.ts$'],
  },
];

module.exports = { contexts, layers };
