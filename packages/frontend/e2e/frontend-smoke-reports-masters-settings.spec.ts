import { randomUUID } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const dateTag = new Date().toISOString().slice(0, 10);
const rootDir = process.env.E2E_ROOT_DIR || process.cwd();
const evidenceDir =
  process.env.E2E_EVIDENCE_DIR ||
  path.join(rootDir, 'docs', 'test-results', `${dateTag}-frontend-e2e`);
const captureEnabled = process.env.E2E_CAPTURE !== '0';
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  // CI runners vary in performance; keep default timeout conservative.
  return process.env.CI ? 30_000 : 12_000;
})();

const authState = {
  userId: 'demo-user',
  roles: ['admin', 'mgmt'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group'],
};

const runId = () =>
  process.env.E2E_RUN_ID ||
  `${Date.now().toString().slice(-6)}-${randomUUID()}`;

function ensureEvidenceDir() {
  if (!captureEnabled) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
}

async function captureSection(locator: Locator, filename: string) {
  if (!captureEnabled) return;
  const capturePath = path.join(evidenceDir, filename);
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
    await expect(locator).toBeVisible({ timeout: 5000 });
    await locator.screenshot({ path: capturePath });
  } catch {
    try {
      await locator.page().screenshot({ path: capturePath, fullPage: true });
    } catch {
      // ignore capture failures to avoid blocking the test flow
    }
  }
}

async function prepare(page: Page, override?: Partial<typeof authState>) {
  const resolvedAuthState = { ...authState, ...(override ?? {}) };
  ensureEvidenceDir();
  page.on('pageerror', (error) => {
    console.error('[e2e][pageerror]', error);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[e2e][console.error]', msg.text());
    }
  });
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, resolvedAuthState);
  await page.goto(baseUrl);
  await expect(
    page.getByRole('heading', { name: 'ERP4 MVP PoC' }),
  ).toBeVisible();
}

async function navigateToSection(page: Page, label: string, heading?: string) {
  // Use exact matching to avoid collisions like "承認" vs "承認依頼".
  await page.getByRole('button', { name: label, exact: true }).click();
  const targetHeading = heading || label;
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: targetHeading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

async function selectByLabelOrFirst(select: Locator, label?: string) {
  await expect
    .poll(() => select.locator('option').count(), { timeout: actionTimeout })
    .toBeGreaterThan(1);
  if (label) {
    await expect
      .poll(() => select.locator('option', { hasText: label }).count(), {
        timeout: actionTimeout,
      })
      .toBeGreaterThan(0);
    await select.selectOption({ label });
    return;
  }
  await select.selectOption({ index: 1 });
}

test('frontend smoke reports masters settings @extended', async ({ page }) => {
  test.setTimeout(180_000);
  const id = runId();
  await prepare(page);

  await navigateToSection(page, 'レポート', 'Reports');
  const reportsSection = page
    .locator('main')
    .locator('h2', { hasText: 'Reports' })
    .locator('..');
  await reportsSection.scrollIntoViewIfNeeded();
  await reportsSection.getByRole('button', { name: 'PJ別工数' }).click();
  await expect(
    reportsSection.getByText('プロジェクト別工数を取得しました'),
  ).toBeVisible();
  await reportsSection.getByRole('button', { name: 'グループ別工数' }).click();
  await expect(
    reportsSection.getByText('グループ別工数を取得しました'),
  ).toBeVisible();
  await reportsSection.getByRole('button', { name: '個人別残業' }).click();
  await expect(
    reportsSection.getByText('個人別残業を取得しました'),
  ).toBeVisible();
  await captureSection(reportsSection, '08-reports.png');

  await navigateToSection(page, '案件');
  const projectsSection = page
    .locator('main')
    .locator('h2', { hasText: '案件' })
    .locator('..');
  await projectsSection.scrollIntoViewIfNeeded();
  await projectsSection.getByLabel('案件コード').fill(`E2E-PRJ-${id}`);
  await projectsSection.getByLabel('案件名称').fill(`E2E Project ${id}`);
  await projectsSection
    .getByLabel('顧客選択')
    .selectOption({ label: 'CUST-DEMO-1 / Demo Customer 1' });
  await projectsSection.getByRole('button', { name: '追加' }).click();
  await expect(projectsSection.getByText('案件を追加しました')).toBeVisible();
  const projectItem = projectsSection.locator('li', {
    hasText: `E2E-PRJ-${id}`,
  });
  await expect(projectItem).toBeVisible();
  await projectItem.getByRole('button', { name: 'メンバー管理' }).click();
  const memberCard = projectItem.locator('.card', {
    hasText: 'メンバー管理',
  });
  await expect(memberCard).toBeVisible();
  await memberCard.getByPlaceholder('候補検索 (2文字以上)').fill('E2E');
  await memberCard.getByRole('button', { name: '検索' }).click();
  await expect(memberCard.getByText('E2E Member 1')).toBeVisible();
  await memberCard
    .locator('li', { hasText: 'e2e-member-1@example.com' })
    .getByRole('button', { name: '選択' })
    .click();
  await expect(memberCard.getByLabel('案件メンバーのユーザID')).toHaveValue(
    'e2e-member-1@example.com',
  );
  await memberCard.getByRole('button', { name: '追加' }).click();
  await expect(memberCard.getByText('e2e-member-1@example.com')).toBeVisible({
    timeout: actionTimeout,
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    memberCard.getByRole('button', { name: 'CSVエクスポート' }).click(),
  ]);
  await expect(download.suggestedFilename()).toContain('project-members-');
  const csv = 'userId,role\n' + 'e2e-member-2@example.com,member\n';
  await memberCard.locator('#project-members-csv-input').setInputFiles({
    name: 'members.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await memberCard.getByRole('button', { name: 'CSVインポート' }).click();
  await expect(memberCard.getByText('e2e-member-2@example.com')).toBeVisible({
    timeout: actionTimeout,
  });
  await captureSection(projectsSection, '09-projects.png');
  await captureSection(memberCard, '09-project-members.png');

  // Ensure role update + removal are exercised (regression guard).
  const member1Item = memberCard.locator('li', {
    hasText: 'e2e-member-1@example.com',
  });
  await member1Item
    .getByLabel('案件メンバーの権限')
    .selectOption({ value: 'leader' });
  await member1Item.getByRole('button', { name: '権限更新' }).click();
  await expect(
    memberCard
      .locator('li', { hasText: 'e2e-member-1@example.com' })
      .locator('.badge'),
  ).toHaveText('leader', { timeout: actionTimeout });

  const member2Item = memberCard.locator('li', {
    hasText: 'e2e-member-2@example.com',
  });
  await member2Item.getByRole('button', { name: '削除' }).click();
  await expect(memberCard.getByText('e2e-member-2@example.com')).toHaveCount(
    0,
    {
      timeout: actionTimeout,
    },
  );

  await navigateToSection(page, 'マスタ管理', '顧客/業者マスタ');
  const masterSection = page
    .locator('main')
    .locator('h2', { hasText: '顧客/業者マスタ' })
    .locator('..');
  await masterSection.scrollIntoViewIfNeeded();
  const customerBlock = masterSection
    .locator('h3', { hasText: '顧客' })
    .locator('..');
  const customerCode = `E2E-CUST-${id}`;
  const customerName = `E2E Customer ${id}`;
  await customerBlock.getByLabel('顧客コード').fill(customerCode);
  await customerBlock.getByLabel('顧客名称').fill(customerName);
  await customerBlock.getByRole('button', { name: '追加' }).click();
  await expect(customerBlock.getByText('顧客を追加しました')).toBeVisible();

  const vendorBlock = masterSection
    .locator('h3', { hasText: '業者' })
    .locator('..');
  const vendorCode = `E2E-VEND-${id}`;
  const vendorName = `E2E Vendor ${id}`;
  await vendorBlock.getByLabel('業者コード').fill(vendorCode);
  await vendorBlock.getByLabel('業者名称').fill(vendorName);
  await vendorBlock.getByRole('button', { name: '追加' }).click();
  await expect(vendorBlock.getByText('業者を追加しました')).toBeVisible();

  // 注釈UI（MasterData: customer/vendor）: 保存 → 再表示で永続化を確認
  const customerItem = customerBlock.locator('li', { hasText: customerCode });
  const customerAnnotationText = `E2E顧客注釈: ${id}`;
  await customerItem.getByRole('button', { name: '注釈' }).click();
  const customerAnnotationDialog = page.getByRole('dialog');
  await expect(
    customerAnnotationDialog.getByRole('heading', {
      name: `顧客: ${customerCode} / ${customerName}`,
      level: 2,
      exact: true,
    }),
  ).toBeVisible({ timeout: actionTimeout });
  await customerAnnotationDialog
    .getByLabel('メモ（Markdown）')
    .fill(customerAnnotationText);
  await customerAnnotationDialog.getByRole('button', { name: '保存' }).click();
  await expect(customerAnnotationDialog.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await customerAnnotationDialog
    .getByRole('button', { name: '閉じる' })
    .click();
  await customerItem.getByRole('button', { name: '注釈' }).click();
  const customerAnnotationDialog2 = page.getByRole('dialog');
  await expect(
    customerAnnotationDialog2.getByLabel('メモ（Markdown）'),
  ).toHaveValue(customerAnnotationText, { timeout: actionTimeout });
  await customerAnnotationDialog2
    .getByRole('button', { name: '閉じる' })
    .click();

  const vendorItem = vendorBlock.locator('li', { hasText: vendorCode });
  const vendorAnnotationText = `E2E業者注釈: ${id}`;
  await vendorItem.getByRole('button', { name: '注釈' }).click();
  const vendorAnnotationDialog = page.getByRole('dialog');
  await expect(
    vendorAnnotationDialog.getByRole('heading', {
      name: `業者: ${vendorCode} / ${vendorName}`,
      level: 2,
      exact: true,
    }),
  ).toBeVisible({ timeout: actionTimeout });
  await vendorAnnotationDialog
    .getByLabel('メモ（Markdown）')
    .fill(vendorAnnotationText);
  await vendorAnnotationDialog.getByRole('button', { name: '保存' }).click();
  await expect(vendorAnnotationDialog.getByText('保存しました')).toBeVisible({
    timeout: actionTimeout,
  });
  await vendorAnnotationDialog.getByRole('button', { name: '閉じる' }).click();
  await vendorItem.getByRole('button', { name: '注釈' }).click();
  const vendorAnnotationDialog2 = page.getByRole('dialog');
  await expect(
    vendorAnnotationDialog2.getByLabel('メモ（Markdown）'),
  ).toHaveValue(vendorAnnotationText, { timeout: actionTimeout });
  await vendorAnnotationDialog2.getByRole('button', { name: '閉じる' }).click();

  const contactBlock = masterSection
    .locator('h3', { hasText: '連絡先' })
    .locator('..');
  const contactOwnerSelect = contactBlock.getByLabel('連絡先の紐付け先');
  await expect(
    contactOwnerSelect.locator('option', { hasText: customerCode }),
  ).toHaveCount(1);
  await contactOwnerSelect.selectOption({
    label: `${customerCode} / ${customerName}`,
  });
  await contactBlock.getByLabel('連絡先氏名').fill(`E2E Contact ${id}`);
  await contactBlock.getByRole('button', { name: '追加' }).click();
  await expect(contactBlock.getByText('連絡先を追加しました')).toBeVisible();
  await captureSection(masterSection, '10-master-data.png');

  await navigateToSection(page, '設定', 'Settings');
  const settingsSection = page
    .locator('main')
    .locator('h2', { hasText: 'Settings' })
    .locator('..');
  await settingsSection.scrollIntoViewIfNeeded();

  const chatSettingsBlock = settingsSection
    .locator('strong', { hasText: 'チャット設定' })
    .locator('..');
  await captureSection(chatSettingsBlock, '11-chat-settings.png');

  const chatRoomSettingsBlock = settingsSection
    .locator('strong', { hasText: 'チャットルーム設定' })
    .locator('..');
  await expect(chatRoomSettingsBlock).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await captureSection(chatRoomSettingsBlock, '11-chat-room-settings.png');

  const scimBlock = settingsSection
    .locator('strong', { hasText: 'SCIM プロビジョニング' })
    .locator('..');
  await captureSection(scimBlock, '11-scim-provisioning.png');

  const rateCardBlock = settingsSection
    .locator('strong', { hasText: '単価（RateCard）' })
    .locator('..');
  await captureSection(rateCardBlock, '11-rate-card.png');

  const alertBlock = settingsSection
    .locator('strong', { hasText: 'アラート設定（簡易モック）' })
    .locator('..');
  await alertBlock.getByRole('button', { name: '次へ' }).click();
  await expect(
    alertBlock.getByRole('heading', { name: '通知先' }),
  ).toBeVisible();
  await alertBlock.getByRole('button', { name: '次へ' }).click();
  await expect(
    alertBlock.getByRole('heading', { name: 'チャネル確認' }),
  ).toBeVisible();
  await alertBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('アラート設定を作成しました'),
  ).toBeVisible();
  await captureSection(alertBlock, '11-alert-settings.png');
  const approvalBlock = settingsSection
    .locator('strong', { hasText: '承認ルール（簡易モック）' })
    .locator('..');
  await approvalBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('承認ルールを作成しました'),
  ).toBeVisible();
  await captureSection(approvalBlock, '11-approval-rules.png');

  const actionPolicyBlock = settingsSection
    .locator('strong', { hasText: 'ActionPolicy（権限/ロック）' })
    .locator('..');
  const actionPolicyKey = `submit.e2e.${id}`;
  await actionPolicyBlock.getByLabel('subjects (JSON)').fill('{');
  const actionPolicyCreateButtons = actionPolicyBlock.getByRole('button', {
    name: '作成',
  });
  await expect(actionPolicyCreateButtons).toHaveCount(1, {
    timeout: actionTimeout,
  });
  await actionPolicyCreateButtons.click();
  await expect(
    settingsSection.getByText('subjects のJSONが不正です'),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  await actionPolicyBlock.getByLabel('subjects (JSON)').fill('{}');
  await actionPolicyBlock.getByLabel('actionKey').fill(actionPolicyKey);
  await actionPolicyCreateButtons.click();
  await expect(
    settingsSection.getByText('ActionPolicy を作成しました'),
  ).toBeVisible({ timeout: actionTimeout });
  const createdActionPolicyCard = actionPolicyBlock.locator('.list .card', {
    hasText: actionPolicyKey,
  });
  await expect(createdActionPolicyCard).toBeVisible({
    timeout: actionTimeout,
  });
  await createdActionPolicyCard.getByRole('button', { name: '編集' }).click();
  const updatedSubjectsJson = '{"scope":"project","mode":"e2e"}';
  await actionPolicyBlock
    .getByLabel('subjects (JSON)')
    .fill(updatedSubjectsJson);
  await actionPolicyBlock.getByRole('button', { name: '更新' }).click();
  await expect(
    settingsSection.getByText('ActionPolicy を更新しました'),
  ).toBeVisible({ timeout: actionTimeout });
  await expect(createdActionPolicyCard).toContainText('"scope": "project"', {
    timeout: actionTimeout,
  });
  await createdActionPolicyCard
    .getByRole('button', { name: '履歴を見る' })
    .click();
  await expect(
    createdActionPolicyCard.locator('.itdo-audit-timeline'),
  ).toBeVisible({
    timeout: actionTimeout,
  });
  await expect(
    createdActionPolicyCard.getByRole('region', { name: 'Diff output' }),
  ).toBeVisible({
    timeout: actionTimeout,
  });

  const templateBlock = settingsSection
    .locator('strong', { hasText: 'テンプレ設定（見積/請求/発注）' })
    .locator('..');
  const templateSelect = templateBlock.getByLabel('テンプレ');
  await expect(
    templateSelect.locator('option', { hasText: 'Invoice Default' }),
  ).toHaveCount(1);
  await templateSelect.selectOption({ label: 'Invoice Default' });
  const numberRule = `PYYYY-MM-NNNN-${id}`;
  await templateBlock.getByLabel('番号ルール').fill(numberRule);
  await templateBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('テンプレ設定を作成しました'),
  ).toBeVisible();
  await expect(templateBlock.getByText(numberRule)).toBeVisible();
  await captureSection(templateBlock, '11-template-settings.png');

  const reportBlock = settingsSection
    .locator('strong', { hasText: 'レポート購読（配信設定）' })
    .locator('..');
  const reportName = `E2E Report ${id}`;
  await reportBlock.getByLabel('名称').fill(reportName);
  await reportBlock.getByLabel('reportKey').fill('project-effort');
  await reportBlock
    .getByLabel('params (JSON)')
    .fill('{"projectId":"00000000-0000-0000-0000-000000000001"}');
  await reportBlock.getByLabel('recipients (JSON)').fill('{"roles":["mgmt"]}');
  await reportBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('レポート購読を作成しました'),
  ).toBeVisible();
  const reportItem = reportBlock.locator('.list .card', {
    hasText: reportName,
  });
  await expect(reportItem).toBeVisible();
  await reportItem.getByRole('button', { name: '実行' }).click();
  await expect(
    settingsSection.getByText('レポートを実行しました'),
  ).toBeVisible();
  await captureSection(reportBlock, '11-report-subscriptions.png');

  const integrationBlock = settingsSection
    .locator('strong', { hasText: '外部連携設定（HR/CRM）' })
    .locator('..');
  await integrationBlock.getByLabel('名称').fill(`E2E Integration ${id}`);
  await integrationBlock.getByRole('button', { name: '作成' }).click();
  await expect(
    settingsSection.getByText('連携設定を作成しました'),
  ).toBeVisible();
  const integrationItem = integrationBlock.locator('.list .card', {
    hasText: `E2E Integration ${id}`,
  });
  await expect(integrationItem).toBeVisible();
  await integrationItem.getByRole('button', { name: '実行' }).click();
  await expect(settingsSection.getByText('連携を実行しました')).toBeVisible();
  await captureSection(integrationBlock, '11-integration-settings.png');
  await captureSection(settingsSection, '11-admin-settings.png');
});
