export type AdminSettingsMessageSink = (message: string) => void;
export type AdminSettingsErrorLogger = (label: string, err: unknown) => void;

export function parseAdminSettingsJson(
  label: string,
  raw: string,
  setMessage: AdminSettingsMessageSink,
): unknown | undefined | null {
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    // Invalid JSON from manual input is an expected validation case.
    if (import.meta.env.DEV) {
      console.warn(`[AdminSettings] parseJson ${label} failed`, err);
    }
    setMessage(`${label} のJSONが不正です`);
    return null;
  }
}

export function normalizeNullableText(value: string): string | null {
  return value.trim() || null;
}
