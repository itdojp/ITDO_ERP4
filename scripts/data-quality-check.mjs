#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const MODE_VALUES = new Set(["blocking", "advisory", "all"]);
const MONEY_EPSILON = 0.01;
const DEFAULT_SAMPLE_LIMIT = 5;

const CHECK_DEFINITIONS = {
  required_id_missing: {
    severity: "blocking",
    category: "required-identifiers",
    description:
      "Primary identifiers required for imported ERP records are present.",
    reproduction:
      "Remove an id/importBatchKey from a fixture record and run the blocking data-quality command.",
  },
  required_code_missing: {
    severity: "blocking",
    category: "required-codes",
    description: "Project, customer, and vendor master codes are non-empty.",
    reproduction:
      "Set a project/customer/vendor code to an empty value in a fixture and run the blocking data-quality command.",
  },
  duplicate_project_code: {
    severity: "blocking",
    category: "duplicate-codes",
    description: "Active project codes are unique.",
    reproduction:
      "Create two active project fixture records with the same code and run the blocking data-quality command.",
  },
  duplicate_customer_code: {
    severity: "blocking",
    category: "duplicate-codes",
    description: "Customer codes are unique.",
    reproduction:
      "Create two customer fixture records with the same code and run the blocking data-quality command.",
  },
  duplicate_vendor_code: {
    severity: "blocking",
    category: "duplicate-codes",
    description: "Vendor codes are unique.",
    reproduction:
      "Create two vendor fixture records with the same code and run the blocking data-quality command.",
  },
  orphan_time_entry_project: {
    severity: "blocking",
    category: "orphan-references",
    description: "Time entries reference an existing project.",
    reproduction:
      "Point a timeEntry.projectId at a missing project id and run the blocking data-quality command.",
  },
  orphan_billing_line_invoice: {
    severity: "blocking",
    category: "orphan-references",
    description: "Billing lines reference an existing invoice.",
    reproduction:
      "Point a billingLine.invoiceId at a missing invoice id and run the blocking data-quality command.",
  },
  orphan_accounting_journal_event: {
    severity: "blocking",
    category: "orphan-references",
    description:
      "Accounting journal staging rows reference an existing accounting event.",
    reproduction:
      "Point an accountingJournalStaging.eventId at a missing event id and run the blocking data-quality command.",
  },
  invoice_currency_missing: {
    severity: "blocking",
    category: "required-codes",
    description: "Invoices have a non-empty currency code.",
    reproduction:
      "Set invoice.currency to an empty value in a fixture and run the blocking data-quality command.",
  },
  billing_tax_rate_missing: {
    severity: "blocking",
    category: "required-codes",
    description:
      "Billing lines have an explicit taxRate for downstream statutory accounting output.",
    reproduction:
      "Set billingLine.taxRate to null in a fixture and run the blocking data-quality command.",
  },
  invoice_header_line_total_mismatch: {
    severity: "blocking",
    category: "header-line-totals",
    description:
      "Invoice header totalAmount equals the sum of billing line quantity * unitPrice.",
    reproduction:
      "Change invoice.totalAmount so it differs from its billing line total by more than 0.01 and run the blocking data-quality command.",
  },
  accounting_event_source_key_duplicate: {
    severity: "blocking",
    category: "duplicate-integration-keys",
    description:
      "Accounting event sourceTable/sourceId/eventKind keys are unique.",
    reproduction:
      "Create two accountingEvents with the same sourceTable/sourceId/eventKind and run the blocking data-quality command.",
  },
  accounting_journal_ready_missing_side: {
    severity: "blocking",
    category: "debit-credit-integrity",
    description:
      "Ready accounting journal staging rows have at least one debit or credit account code.",
    reproduction:
      "Create a ready accountingJournalStaging row without debitAccountCode and creditAccountCode and run the blocking data-quality command.",
  },
  accounting_journal_debit_credit_mismatch: {
    severity: "blocking",
    category: "debit-credit-integrity",
    description:
      "Ready accounting journal staging debit and credit totals are balanced.",
    reproduction:
      "Create ready accountingJournalStaging rows whose debit-side amount total differs from credit-side amount total and run the blocking data-quality command.",
  },
  statutory_accounting_import_count_mismatch: {
    severity: "blocking",
    category: "migration-import-integrity",
    description:
      "Statutory accounting import batch importedCount matches actual imported rows.",
    reproduction:
      "Set statutoryAccountingActualImportBatch.importedCount to a value different from actual row count and run the blocking data-quality command.",
  },
  time_entries_daily_over_1440: {
    severity: "advisory",
    category: "business-threshold",
    description:
      "Daily time entry totals above 1,440 minutes are recorded for operational review.",
    reproduction:
      "Create time entries for one user/date whose minutes exceed 1,440 and run the advisory data-quality command.",
  },
  invoice_number_format_invalid: {
    severity: "advisory",
    category: "format-warning",
    description:
      "Invoice numbers that do not follow the current IYYYY-MM-NNNN convention are reported.",
    reproduction:
      "Set invoice.invoiceNo to a value outside IYYYY-MM-NNNN and run the advisory data-quality command.",
  },
  purchase_order_number_format_invalid: {
    severity: "advisory",
    category: "format-warning",
    description:
      "Purchase order numbers that do not follow the current POYYYY-MM-NNNN convention are reported.",
    reproduction:
      "Set purchaseOrder.poNo to a value outside POYYYY-MM-NNNN and run the advisory data-quality command.",
  },
};

const BLOCKING_CHECKS = Object.entries(CHECK_DEFINITIONS)
  .filter(([, definition]) => definition.severity === "blocking")
  .map(([name]) => name);
const ADVISORY_CHECKS = Object.entries(CHECK_DEFINITIONS)
  .filter(([, definition]) => definition.severity === "advisory")
  .map(([name]) => name);

function parseArgs(argv) {
  const options = {
    mode: "blocking",
    fixture: null,
    output: null,
    summary: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--mode") {
      options.mode = argv[++index];
      continue;
    }
    if (arg.startsWith("--fixture=")) {
      options.fixture = arg.slice("--fixture=".length);
      continue;
    }
    if (arg === "--fixture") {
      options.fixture = argv[++index];
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
      continue;
    }
    if (arg === "--output") {
      options.output = argv[++index];
      continue;
    }
    if (arg.startsWith("--summary=")) {
      options.summary = arg.slice("--summary=".length);
      continue;
    }
    if (arg === "--summary") {
      options.summary = argv[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!MODE_VALUES.has(options.mode)) {
    throw new Error(
      `Invalid --mode: ${options.mode}. Expected one of ${Array.from(MODE_VALUES).join(", ")}`,
    );
  }
  if (!options.fixture) {
    throw new Error("Missing required --fixture <path> argument.");
  }
  if (!options.output) {
    const suffix = options.mode === "all" ? "all" : options.mode;
    options.output = path.join("tmp", `data-quality-${suffix}.json`);
  }
  if (!options.summary) {
    const suffix = options.mode === "all" ? "all" : options.mode;
    options.summary = path.join("tmp", `data-quality-${suffix}.md`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/data-quality-check.mjs --mode <blocking|advisory|all> --fixture <path> [--output <path>] [--summary <path>]

The runner evaluates synthetic data-quality fixtures. Blocking findings exit with status 1 in blocking/all mode. Advisory findings are reported but exit with status 0.`);
}

function resolveFromCwd(value) {
  return path.resolve(process.cwd(), value);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readFixture(fixturePath) {
  const absolutePath = resolveFromCwd(fixturePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  return {
    absolutePath,
    fixture: JSON.parse(raw),
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeFixture(fixture) {
  return {
    schemaVersion: fixture.schemaVersion ?? 1,
    description: fixture.description ?? "synthetic fixture",
    projects: asArray(fixture.projects),
    customers: asArray(fixture.customers),
    vendors: asArray(fixture.vendors),
    timeEntries: asArray(fixture.timeEntries),
    invoices: asArray(fixture.invoices),
    billingLines: asArray(fixture.billingLines),
    accountingEvents: asArray(fixture.accountingEvents),
    accountingJournalStaging: asArray(fixture.accountingJournalStaging),
    statutoryAccountingActualImportBatches: asArray(
      fixture.statutoryAccountingActualImportBatches,
    ),
    statutoryAccountingActuals: asArray(fixture.statutoryAccountingActuals),
    purchaseOrders: asArray(fixture.purchaseOrders),
  };
}

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function isActive(record) {
  return !isPresent(record.deletedAt);
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid numeric value in data-quality fixture: ${value}`);
  }
  return numeric;
}

function sample(values, limit = DEFAULT_SAMPLE_LIMIT) {
  return values.slice(0, limit).map((value) => String(value));
}

function makeResult(name, sampleIds = [], details = []) {
  const definition = CHECK_DEFINITIONS[name];
  if (!definition) throw new Error(`Unknown check definition: ${name}`);
  return {
    name,
    severity: definition.severity,
    category: definition.category,
    status:
      sampleIds.length > 0
        ? definition.severity === "blocking"
          ? "fail"
          : "warning"
        : "pass",
    count: sampleIds.length,
    sampleIds: sample(sampleIds),
    description: definition.description,
    reproduction: definition.reproduction,
    details: sample(details),
  };
}

function findMissingIds(data) {
  const samples = [];
  const details = [];
  const idCollections = [
    ["Project", data.projects, "id"],
    ["Customer", data.customers, "id"],
    ["Vendor", data.vendors, "id"],
    ["TimeEntry", data.timeEntries, "id"],
    ["Invoice", data.invoices, "id"],
    ["BillingLine", data.billingLines, "id"],
    ["AccountingEvent", data.accountingEvents, "id"],
    ["AccountingJournalStaging", data.accountingJournalStaging, "id"],
    [
      "StatutoryAccountingActualImportBatch",
      data.statutoryAccountingActualImportBatches,
      "importBatchKey",
    ],
    ["StatutoryAccountingActual", data.statutoryAccountingActuals, "id"],
    ["PurchaseOrder", data.purchaseOrders, "id"],
  ];

  for (const [entity, records, key] of idCollections) {
    records.forEach((record, index) => {
      if (!isPresent(record[key])) {
        samples.push(`${entity}[${index}]`);
        details.push(`${entity}[${index}] missing ${key}`);
      }
    });
  }
  return makeResult("required_id_missing", samples, details);
}

function findMissingCodes(data) {
  const samples = [];
  const details = [];
  const codeCollections = [
    ["Project", data.projects],
    ["Customer", data.customers],
    ["Vendor", data.vendors],
  ];

  for (const [entity, records] of codeCollections) {
    records.forEach((record) => {
      if (!isPresent(record.code)) {
        const identifier = isPresent(record.id)
          ? record.id
          : `${entity}:unknown-id`;
        samples.push(`${entity}:${identifier}`);
        details.push(`${entity}:${identifier} missing code`);
      }
    });
  }
  return makeResult("required_code_missing", samples, details);
}

function duplicateCodeResult(name, records, entityName) {
  const grouped = new Map();
  records.filter(isActive).forEach((record) => {
    if (!isPresent(record.code)) return;
    const code = String(record.code).trim();
    const current = grouped.get(code) ?? [];
    current.push(
      isPresent(record.id) ? String(record.id) : `${entityName}:unknown-id`,
    );
    grouped.set(code, current);
  });

  const samples = [];
  const details = [];
  for (const [code, ids] of grouped.entries()) {
    if (ids.length <= 1) continue;
    samples.push(code);
    details.push(`${code}: ${ids.join(",")}`);
  }
  return makeResult(name, samples, details);
}

function orphanResult(name, records, referenceIds, recordEntity, referenceKey) {
  const samples = [];
  const details = [];
  records.filter(isActive).forEach((record) => {
    const referenceId = record[referenceKey];
    if (!isPresent(referenceId)) return;
    if (!referenceIds.has(String(referenceId))) {
      const id = isPresent(record.id)
        ? record.id
        : `${recordEntity}:unknown-id`;
      samples.push(id);
      details.push(
        `${recordEntity}:${id} references missing ${referenceKey}=${referenceId}`,
      );
    }
  });
  return makeResult(name, samples, details);
}

function invoiceCurrencyMissing(data) {
  const samples = [];
  const details = [];
  data.invoices.filter(isActive).forEach((invoice) => {
    if (!isPresent(invoice.currency)) {
      const id = isPresent(invoice.id) ? invoice.id : "Invoice:unknown-id";
      samples.push(id);
      details.push(`${id} missing currency`);
    }
  });
  return makeResult("invoice_currency_missing", samples, details);
}

function billingTaxRateMissing(data) {
  const samples = [];
  const details = [];
  data.billingLines.filter(isActive).forEach((line) => {
    if (
      line.taxRate === undefined ||
      line.taxRate === null ||
      line.taxRate === ""
    ) {
      const id = isPresent(line.id) ? line.id : "BillingLine:unknown-id";
      samples.push(id);
      details.push(`${id} missing taxRate`);
    }
  });
  return makeResult("billing_tax_rate_missing", samples, details);
}

function invoiceHeaderLineTotalMismatch(data) {
  const linesByInvoice = new Map();
  data.billingLines.filter(isActive).forEach((line) => {
    if (!isPresent(line.invoiceId)) return;
    const current = linesByInvoice.get(String(line.invoiceId)) ?? [];
    current.push(line);
    linesByInvoice.set(String(line.invoiceId), current);
  });

  const samples = [];
  const details = [];
  data.invoices.filter(isActive).forEach((invoice) => {
    if (!isPresent(invoice.id)) return;
    const lines = linesByInvoice.get(String(invoice.id)) ?? [];
    const lineTotal = lines.reduce(
      (total, line) =>
        total + toNumber(line.quantity ?? 1) * toNumber(line.unitPrice),
      0,
    );
    const headerTotal = toNumber(invoice.totalAmount);
    const diff = Math.abs(headerTotal - lineTotal);
    if (diff > MONEY_EPSILON) {
      const id = String(invoice.id);
      samples.push(id);
      details.push(
        `${id}: header=${headerTotal.toFixed(2)}, lines=${lineTotal.toFixed(2)}, diff=${diff.toFixed(2)}`,
      );
    }
  });
  return makeResult("invoice_header_line_total_mismatch", samples, details);
}

function accountingEventSourceKeyDuplicate(data) {
  const grouped = new Map();
  data.accountingEvents.filter(isActive).forEach((event) => {
    const parts = [event.sourceTable, event.sourceId, event.eventKind];
    if (!parts.every(isPresent)) return;
    const key = parts.map((part) => String(part).trim()).join("/");
    const current = grouped.get(key) ?? [];
    current.push(
      isPresent(event.id) ? String(event.id) : "AccountingEvent:unknown-id",
    );
    grouped.set(key, current);
  });

  const samples = [];
  const details = [];
  for (const [key, ids] of grouped.entries()) {
    if (ids.length <= 1) continue;
    samples.push(key);
    details.push(`${key}: ${ids.join(",")}`);
  }
  return makeResult("accounting_event_source_key_duplicate", samples, details);
}

function accountingJournalReadyMissingSide(data) {
  const samples = [];
  const details = [];
  data.accountingJournalStaging.filter(isActive).forEach((row) => {
    if (row.status !== "ready") return;
    if (!isPresent(row.debitAccountCode) && !isPresent(row.creditAccountCode)) {
      const id = isPresent(row.id)
        ? row.id
        : "AccountingJournalStaging:unknown-id";
      samples.push(id);
      details.push(
        `${id} ready row missing both debitAccountCode and creditAccountCode`,
      );
    }
  });
  return makeResult("accounting_journal_ready_missing_side", samples, details);
}

function accountingJournalDebitCreditMismatch(data) {
  let debitTotal = 0;
  let creditTotal = 0;
  const contributingRows = [];

  data.accountingJournalStaging.filter(isActive).forEach((row) => {
    if (row.status !== "ready") return;
    const amount = toNumber(row.amount);
    const rowId = isPresent(row.id)
      ? row.id
      : "AccountingJournalStaging:unknown-id";
    if (isPresent(row.debitAccountCode)) {
      debitTotal += amount;
      contributingRows.push(`${rowId}:debit=${amount.toFixed(2)}`);
    }
    if (isPresent(row.creditAccountCode)) {
      creditTotal += amount;
      contributingRows.push(`${rowId}:credit=${amount.toFixed(2)}`);
    }
  });

  const diff = Math.abs(debitTotal - creditTotal);
  if (diff <= MONEY_EPSILON) {
    return makeResult("accounting_journal_debit_credit_mismatch");
  }
  return makeResult(
    "accounting_journal_debit_credit_mismatch",
    [`debit=${debitTotal.toFixed(2)};credit=${creditTotal.toFixed(2)}`],
    contributingRows,
  );
}

function statutoryAccountingImportCountMismatch(data) {
  const actualCounts = new Map();
  data.statutoryAccountingActuals.forEach((actual) => {
    if (!isPresent(actual.importBatchKey)) return;
    const key = String(actual.importBatchKey);
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  });

  const samples = [];
  const details = [];
  data.statutoryAccountingActualImportBatches.forEach((batch) => {
    if (!isPresent(batch.importBatchKey)) return;
    const key = String(batch.importBatchKey);
    const expected = toNumber(batch.importedCount);
    const actual = actualCounts.get(key) ?? 0;
    if (expected !== actual) {
      samples.push(key);
      details.push(`${key}: expected=${expected}, actual=${actual}`);
    }
  });
  return makeResult(
    "statutory_accounting_import_count_mismatch",
    samples,
    details,
  );
}

function timeEntriesDailyOver1440(data) {
  const grouped = new Map();
  data.timeEntries.filter(isActive).forEach((entry) => {
    if (!isPresent(entry.userId) || !isPresent(entry.workDate)) return;
    const date = String(entry.workDate).slice(0, 10);
    const key = `${entry.userId}:${date}`;
    grouped.set(key, (grouped.get(key) ?? 0) + toNumber(entry.minutes));
  });

  const samples = [];
  const details = [];
  for (const [key, minutes] of grouped.entries()) {
    if (minutes <= 1440) continue;
    samples.push(key);
    details.push(`${key}: minutes=${minutes}`);
  }
  return makeResult("time_entries_daily_over_1440", samples, details);
}

function invoiceNumberFormatInvalid(data) {
  const invoiceNoRegex = /^I[0-9]{4}-[0-9]{2}-[0-9]{4}$/;
  const samples = [];
  const details = [];
  data.invoices.filter(isActive).forEach((invoice) => {
    if (!isPresent(invoice.invoiceNo)) return;
    const invoiceNo = String(invoice.invoiceNo);
    if (!invoiceNoRegex.test(invoiceNo)) {
      const id = isPresent(invoice.id) ? invoice.id : "Invoice:unknown-id";
      samples.push(id);
      details.push(`${id}: ${invoiceNo}`);
    }
  });
  return makeResult("invoice_number_format_invalid", samples, details);
}

function purchaseOrderNumberFormatInvalid(data) {
  const poNoRegex = /^PO[0-9]{4}-[0-9]{2}-[0-9]{4}$/;
  const samples = [];
  const details = [];
  data.purchaseOrders.filter(isActive).forEach((purchaseOrder) => {
    if (!isPresent(purchaseOrder.poNo)) return;
    const poNo = String(purchaseOrder.poNo);
    if (!poNoRegex.test(poNo)) {
      const id = isPresent(purchaseOrder.id)
        ? purchaseOrder.id
        : "PurchaseOrder:unknown-id";
      samples.push(id);
      details.push(`${id}: ${poNo}`);
    }
  });
  return makeResult("purchase_order_number_format_invalid", samples, details);
}

function runChecks(data, mode) {
  const projectIds = new Set(
    data.projects
      .filter(isActive)
      .filter((p) => isPresent(p.id))
      .map((p) => String(p.id)),
  );
  const invoiceIds = new Set(
    data.invoices
      .filter(isActive)
      .filter((i) => isPresent(i.id))
      .map((i) => String(i.id)),
  );
  const accountingEventIds = new Set(
    data.accountingEvents
      .filter(isActive)
      .filter((event) => isPresent(event.id))
      .map((event) => String(event.id)),
  );

  const checks = {
    required_id_missing: () => findMissingIds(data),
    required_code_missing: () => findMissingCodes(data),
    duplicate_project_code: () =>
      duplicateCodeResult("duplicate_project_code", data.projects, "Project"),
    duplicate_customer_code: () =>
      duplicateCodeResult(
        "duplicate_customer_code",
        data.customers,
        "Customer",
      ),
    duplicate_vendor_code: () =>
      duplicateCodeResult("duplicate_vendor_code", data.vendors, "Vendor"),
    orphan_time_entry_project: () =>
      orphanResult(
        "orphan_time_entry_project",
        data.timeEntries,
        projectIds,
        "TimeEntry",
        "projectId",
      ),
    orphan_billing_line_invoice: () =>
      orphanResult(
        "orphan_billing_line_invoice",
        data.billingLines,
        invoiceIds,
        "BillingLine",
        "invoiceId",
      ),
    orphan_accounting_journal_event: () =>
      orphanResult(
        "orphan_accounting_journal_event",
        data.accountingJournalStaging,
        accountingEventIds,
        "AccountingJournalStaging",
        "eventId",
      ),
    invoice_currency_missing: () => invoiceCurrencyMissing(data),
    billing_tax_rate_missing: () => billingTaxRateMissing(data),
    invoice_header_line_total_mismatch: () =>
      invoiceHeaderLineTotalMismatch(data),
    accounting_event_source_key_duplicate: () =>
      accountingEventSourceKeyDuplicate(data),
    accounting_journal_ready_missing_side: () =>
      accountingJournalReadyMissingSide(data),
    accounting_journal_debit_credit_mismatch: () =>
      accountingJournalDebitCreditMismatch(data),
    statutory_accounting_import_count_mismatch: () =>
      statutoryAccountingImportCountMismatch(data),
    time_entries_daily_over_1440: () => timeEntriesDailyOver1440(data),
    invoice_number_format_invalid: () => invoiceNumberFormatInvalid(data),
    purchase_order_number_format_invalid: () =>
      purchaseOrderNumberFormatInvalid(data),
  };

  const names =
    mode === "blocking"
      ? BLOCKING_CHECKS
      : mode === "advisory"
        ? ADVISORY_CHECKS
        : [...BLOCKING_CHECKS, ...ADVISORY_CHECKS];
  return names.map((name) => checks[name]());
}

function toSummaryStatus(mode, results) {
  const blockingFindings = results
    .filter((result) => result.severity === "blocking")
    .reduce((total, result) => total + result.count, 0);
  const advisoryFindings = results
    .filter((result) => result.severity === "advisory")
    .reduce((total, result) => total + result.count, 0);

  if ((mode === "blocking" || mode === "all") && blockingFindings > 0) {
    return "fail";
  }
  if (advisoryFindings > 0) return "warning";
  return "pass";
}

function buildReport({ mode, fixturePath, fixture, results }) {
  const blockingFindings = results
    .filter((result) => result.severity === "blocking")
    .reduce((total, result) => total + result.count, 0);
  const advisoryFindings = results
    .filter((result) => result.severity === "advisory")
    .reduce((total, result) => total + result.count, 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    fixture: path.relative(rootDir, fixturePath).replace(/\\/g, "/"),
    fixtureDescription: fixture.description,
    status: toSummaryStatus(mode, results),
    summary: {
      checks: results.length,
      blockingFindings,
      advisoryFindings,
    },
    checks: results,
  };
}

function buildMarkdownSummary(report) {
  const title =
    report.mode === "blocking"
      ? "Blocking data-quality checks"
      : report.mode === "advisory"
        ? "Advisory data-quality checks"
        : "Data-quality checks";
  const lines = [
    `## ${title}`,
    "",
    `- Status: **${report.status}**`,
    `- Fixture: \`${report.fixture}\``,
    `- Blocking findings: ${report.summary.blockingFindings}`,
    `- Advisory findings: ${report.summary.advisoryFindings}`,
    "",
    "| Check | Severity | Status | Count | Sample IDs | Reproduce |",
    "| --- | --- | --- | ---: | --- | --- |",
  ];

  for (const result of report.checks) {
    const sampleText =
      result.sampleIds.length > 0 ? result.sampleIds.join("<br>") : "-";
    lines.push(
      `| \`${result.name}\` | ${result.severity} | ${result.status} | ${result.count} | ${sampleText} | ${result.reproduction} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeReport(report, outputPath, summaryPath) {
  ensureParentDir(outputPath);
  ensureParentDir(summaryPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(summaryPath, buildMarkdownSummary(report));
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return 0;
    }
    const { absolutePath, fixture } = readFixture(options.fixture);
    const data = normalizeFixture(fixture);
    const results = runChecks(data, options.mode);
    const report = buildReport({
      mode: options.mode,
      fixturePath: absolutePath,
      fixture: data,
      results,
    });
    const outputPath = resolveFromCwd(options.output);
    const summaryPath = resolveFromCwd(options.summary);
    writeReport(report, outputPath, summaryPath);
    console.log(
      `[data-quality] ${report.status}: ${report.summary.blockingFindings} blocking findings, ${report.summary.advisoryFindings} advisory findings`,
    );
    console.log(
      `[data-quality] report: ${path.relative(process.cwd(), outputPath)}`,
    );
    console.log(
      `[data-quality] summary: ${path.relative(process.cwd(), summaryPath)}`,
    );
    return report.status === "fail" ? 1 : 0;
  } catch (error) {
    console.error(
      `[data-quality] ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

process.exitCode = main();
