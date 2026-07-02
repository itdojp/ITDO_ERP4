import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const fixedNow = new Date('2026-07-02T09:00:00+09:00');
const rootDir = process.env.E2E_ROOT_DIR || path.resolve(__dirname, '../../..');
const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const visualRegressionEnabled = process.env.UIUX_VISUAL_REGRESSION === '1';
const visualStabilityStyle = path.join(
  rootDir,
  'packages',
  'frontend',
  'e2e',
  'uiux-visual-regression.css',
);
const actionTimeout = (() => {
  const raw = process.env.E2E_ACTION_TIMEOUT_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return process.env.CI ? 30_000 : 12_000;
})();

const authState = {
  userId: 'demo-user',
  roles: ['system_admin', 'admin', 'mgmt', 'hr', 'exec'],
  projectIds: ['00000000-0000-0000-0000-000000000001'],
  groupIds: ['mgmt', 'hr-group', 'general_affairs', 'exec'],
  groupAccountIds: ['mgmt', 'hr-group', 'general_affairs'],
};

type VisualCase = {
  phase: string;
  navLabel: string;
  heading: string;
  summaryLabel: string;
  snapshot: string;
};

const visualCases: VisualCase[] = [
  {
    phase: 'phase-01',
    navLabel: '日報 + ウェルビーイング',
    heading: '日報 + ウェルビーイング',
    summaryLabel: '日報とウェルビーイングの状態サマリー',
    snapshot: 'phase-01-daily-report.png',
  },
  {
    phase: 'phase-02',
    navLabel: '請求',
    heading: '請求',
    summaryLabel: '請求判断サマリー',
    snapshot: 'phase-02-invoices.png',
  },
  {
    phase: 'phase-03',
    navLabel: '承認',
    heading: '承認一覧',
    summaryLabel: '承認判断サマリー',
    snapshot: 'phase-03-approvals.png',
  },
  {
    phase: 'phase-04',
    navLabel: 'レポート',
    heading: 'Reports',
    summaryLabel: 'レポート判断サマリー',
    snapshot: 'phase-04-reports.png',
  },
  {
    phase: 'phase-05',
    navLabel: 'ルームチャット',
    heading: 'チャット（全社/部門/private_group/DM）',
    summaryLabel: 'チャット運用サマリー',
    snapshot: 'phase-05-room-chat.png',
  },
  {
    phase: 'phase-06',
    navLabel: 'マスタ管理',
    heading: '顧客/業者マスタ',
    summaryLabel: 'マスタ管理サマリー',
    snapshot: 'phase-06-master-data.png',
  },
  {
    phase: 'phase-07',
    navLabel: '設定',
    heading: 'Settings',
    summaryLabel: '設定管理サマリー',
    snapshot: 'phase-07-admin-settings.png',
  },
  {
    phase: 'phase-08',
    navLabel: 'PDF管理',
    heading: 'PDFファイル一覧',
    summaryLabel: 'PDF管理サマリー',
    snapshot: 'phase-08-pdf-files.png',
  },
  {
    phase: 'phase-09',
    navLabel: 'アクセスレビュー',
    heading: 'アクセス棚卸し',
    summaryLabel: 'アクセス棚卸しサマリー',
    snapshot: 'phase-09-access-reviews.png',
  },
  {
    phase: 'phase-10',
    navLabel: '送信ログ',
    heading: 'ドキュメント送信ログ',
    summaryLabel: '送信ログ監査サマリー',
    snapshot: 'phase-10-document-send-logs.png',
  },
  {
    phase: 'phase-11',
    navLabel: '期間締め',
    heading: '期間締め',
    summaryLabel: '期間締めサマリー',
    snapshot: 'phase-11-period-locks.png',
  },
  {
    phase: 'phase-12',
    navLabel: 'ホーム',
    heading: 'Dashboard',
    summaryLabel: 'ホームサマリー',
    snapshot: 'phase-12-dashboard.png',
  },
];

async function prepare(page: Page) {
  page.on('pageerror', (error) => {
    console.error('[e2e][pageerror]', error);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('[e2e][console.error]', msg.text());
    }
  });
  await page.clock.setFixedTime(fixedNow);
  await page.addInitScript((state) => {
    window.localStorage.setItem('erp4_auth', JSON.stringify(state));
    window.localStorage.removeItem('erp4_active_section');
  }, authState);
  await page.goto(baseUrl);
  await expect(page.getByRole('heading', { name: 'ERP4 MVP PoC' })).toBeVisible(
    { timeout: actionTimeout },
  );
}

async function navigateToSection(page: Page, label: string, heading: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(
    page
      .locator('main')
      .getByRole('heading', { name: heading, level: 2, exact: true }),
  ).toBeVisible({ timeout: actionTimeout });
}

function sectionByHeading(page: Page, heading: string) {
  return page
    .locator('main')
    .getByRole('heading', { name: heading, level: 2, exact: true })
    .locator('..');
}

async function waitForVisualStability(page: Page, section: Locator) {
  await section.scrollIntoViewIfNeeded({ timeout: actionTimeout });
  await expect(section).toBeVisible({ timeout: actionTimeout });
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
}

test.describe('UX/UI phase screenshot visual regression @visual', () => {
  test.skip(
    !visualRegressionEnabled,
    'Set UIUX_VISUAL_REGRESSION=1 to run screenshot comparison.',
  );

  test.use({
    colorScheme: 'light',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 720 },
  });

  for (const item of visualCases) {
    test(`${item.phase} ${item.navLabel} visual baseline @visual`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await prepare(page);
      await navigateToSection(page, item.navLabel, item.heading);

      const section = sectionByHeading(page, item.heading);
      await expect(
        section.locator(`[aria-label="${item.summaryLabel}"]`),
      ).toBeVisible({ timeout: actionTimeout });
      await waitForVisualStability(page, section);

      await expect(section).toHaveScreenshot(item.snapshot, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.02,
        scale: 'css',
        stylePath: visualStabilityStyle,
        threshold: 0.2,
      });
    });
  }
});
