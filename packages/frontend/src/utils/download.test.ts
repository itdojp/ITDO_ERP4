import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadResponseAsFile,
  formatDateForFilename,
  openResponseInNewTab,
  resolveFilename,
} from './download';

function createMockResponse(
  filename: string,
  disposition?: string | null,
): Response {
  return {
    blob: vi.fn().mockResolvedValue(new Blob(['payload'])),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-disposition'
          ? (disposition ?? `attachment; filename="${filename}"`)
          : null,
    } as Headers,
  } as unknown as Response;
}

describe('download utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('formats dates for filenames', () => {
    expect(formatDateForFilename(new Date('2026-03-25T12:00:00.000Z'))).toBe(
      '2026-03-25',
    );
  });

  it('resolves filenames from content-disposition headers', () => {
    expect(
      resolveFilename("attachment; filename*=UTF-8''report%20v1.csv", 'x.csv'),
    ).toBe('report v1.csv');
    expect(resolveFilename('attachment; filename="report.csv"', 'x.csv')).toBe(
      'report.csv',
    );
    expect(resolveFilename(undefined, 'fallback.csv')).toBe('fallback.csv');
  });

  it('downloads response as file with resolved filename', async () => {
    vi.useFakeTimers();
    const objectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:download');
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {
        return undefined;
      });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const res = createMockResponse('export.csv');

    await downloadResponseAsFile(res, 'fallback.csv');

    expect(clickSpy).toHaveBeenCalled();
    expect(objectUrlSpy).toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(document.querySelector('a')).toBeNull();
    vi.runOnlyPendingTimers();
    expect(revokeSpy).toHaveBeenCalledWith('blob:download');
    vi.useRealTimers();
  });

  it('falls back to download when window.open is blocked', async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:open');
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {
        return undefined;
      });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    vi.spyOn(window, 'open').mockReturnValue(null);

    const res = createMockResponse('fallback.pdf');

    await openResponseInNewTab(res, 'fallback.pdf');

    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(revokeSpy).toHaveBeenCalledWith('blob:open');
    vi.useRealTimers();
  });

  it('keeps encoded filename text when filename* decoding fails', () => {
    expect(
      resolveFilename(
        "attachment; filename*=UTF-8''broken%ZZname.csv",
        'x.csv',
      ),
    ).toBe('broken%ZZname.csv');
  });

  it('trims raw filenames from content-disposition headers', () => {
    expect(
      resolveFilename('attachment; filename= raw-report.csv ', 'x.csv'),
    ).toBe('raw-report.csv');
  });

  it('opens the blob in a new tab without using the download fallback when window.open succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:opened');
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const windowOpenSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue({} as Window);

    const res = createMockResponse('report.pdf');

    await openResponseInNewTab(res, 'fallback.pdf');

    expect(windowOpenSpy).toHaveBeenCalledWith(
      'blob:opened',
      '_blank',
      'noopener,noreferrer',
    );
    expect(clickSpy).not.toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(revokeSpy).toHaveBeenCalledWith('blob:opened');
    vi.useRealTimers();
  });
});
