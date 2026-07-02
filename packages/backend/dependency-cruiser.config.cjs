// See docs/architecture/greenfield-ideal-design.md section 1.1.
// This gate treats lower-index contexts as more stable/foundational and forbids
// direct imports from those contexts to higher-level contexts. Existing
// violations are baselined in dependency-cruiser-known-violations.json so new
// violations fail CI while current hotspots are reduced incrementally.

const contexts = [
  {
    name: 'identity-access',
    displayName: 'Identity & Access',
    patterns: [
      '^src/plugins/auth\\.ts$',
      '^src/routes/(accessReviews|auth|groups|scim)\\.ts$',
      '^src/services/(authContext|authGateway|localCredentials|rbac|userIdentity|userIdentitySession|rateLimitOverrides)\\.ts$',
      '^src/utils/authGroupToRoleMap\\.ts$',
    ],
  },
  {
    name: 'org-project',
    displayName: 'Org & Project',
    patterns: [
      '^src/routes/(assignments|departments|employees|projectAssignments|projectMembers|projects|projectWbs|workAssignments)\\.ts$',
      '^src/services/(department|laborCost|project|projectAccess|projectAssignments|projectWbs|workAssignment)\\.ts$',
    ],
  },
  {
    name: 'master-data',
    displayName: 'Master Data',
    patterns: [
      '^src/routes/(accounts|contacts|customers|rateCards|serviceItems|taxRates|vendors)\\.ts$',
      '^src/services/(accounts|contacts|customers|rateCards|serviceItems|taxRates|vendors)\\.ts$',
    ],
  },
  {
    name: 'documents',
    displayName: 'Documents',
    patterns: [
      '^src/routes/(dailyReports|documentSendLogs|drafts|estimates|expenses|invoices|leaveRequests|manualJournals|purchaseOrders|vendorDocuments|vendorInvoices|workLogs)\\.ts$',
      '^src/services/(documentSend|estimate|invoice|leaveCompGrants|manualJournal|numbering|payrollActuals|vendorInvoice|worklogSetting)\\.ts$',
    ],
  },
  {
    name: 'workflow',
    displayName: 'Workflow',
    patterns: [
      '^src/routes/(actionPolicies|approvalRules|locks|periodLocks)\\.ts$',
      '^src/services/(actionPolicy|actionPolicyAudit|actionPolicyErrors|approval|approvalEscalation|approvalLogic|approvalRuleSelection|periodLock|reassignmentLog)\\.ts$',
    ],
  },
  {
    name: 'evidence-references',
    displayName: 'Evidence & References',
    patterns: [
      '^src/routes/(annotations|annotationSettings|evidenceSnapshots|referenceLinks)\\.ts$',
      '^src/services/(annotationReferences|evidencePackArchive|evidencePackExport|evidenceSnapshot|referenceLinks)\\.ts$',
    ],
  },
  {
    name: 'chat',
    displayName: 'Chat',
    patterns: [
      '^src/routes/chat[^/]*\\.ts$',
      '^src/routes/chat/.+\\.ts$',
      '^src/services/(chat|chatAck|chatAckCandidates|chatAckLimits|chatAckLinkTargets|chatAckNotifications|chatAckRecipients|chatAckTemplates|chatAttachmentScan|chatAttachments|chatExternalLlm|chatMentionCandidates|chatMentionRecipients|chatReadState|chatRoomAccess|personalGaChatRoom)[^/]*\\.ts$',
    ],
  },
  {
    name: 'notifications',
    displayName: 'Notifications',
    patterns: [
      '^src/routes/(alertSettings|alerts|notifications)\\.ts$',
      '^src/services/(alertService|appNotifications|emailNotifications|notificationDigest|notificationSettings|pushNotifications)\\.ts$',
    ],
  },
  {
    name: 'integrations',
    displayName: 'Integrations',
    patterns: [
      '^src/routes/(googleDrive|sendGridWebhook|slack|webhooks)\\.ts$',
      '^src/services/(externalPdf|googleDrive|s3|sendGrid|slack|webPush|webhook)[^/]*\\.ts$',
    ],
  },
  {
    name: 'ops',
    displayName: 'Ops',
    patterns: [
      '^src/index\\.ts$',
      '^src/server\\.ts$',
      '^src/routes/(agent360|agentRuns|auditLogs|dataQualityJobs|jobs|metrics|health)\\.ts$',
      '^src/services/(agentRuns|dataQuality|envValidation|jobs|metrics|ops|queue|s3Backup)\\.ts$',
    ],
  },
];

function contextRule(fromContext, forbiddenContexts) {
  return {
    name: `bounded-context-${fromContext.name}-direction`,
    comment: `${fromContext.displayName} must not import contexts that are later in the documented dependency direction; use an application service, event, or documented adapter instead. See docs/architecture/greenfield-ideal-design.md#11-バウンデッドコンテキストモジュール分割`,
    severity: 'error',
    from: { path: fromContext.patterns },
    to: { path: forbiddenContexts.flatMap((context) => context.patterns) },
  };
}

module.exports = {
  forbidden: contexts
    .map((context, index) => contextRule(context, contexts.slice(index + 1)))
    .filter((rule) => rule.to.path.length > 0),
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|coverage|node_modules|test)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
  },
};
