// Wording for the equipment table and for the equipment alert (the email mirrors it in
// Python: `victron/email_i18n.py`, `alert_device_*`).
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';

type Params = Record<string, string | number | null | undefined>;

export function fill(template: string, values: Params): string {
  return Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v === null || v === undefined ? '—' : String(v)), template);
}

/** "Solar charger 2" (or just "Solar charger" when the site has one), "Battery", "Inverter". */
export function deviceName(lang: Lang, kind: string, n?: number | null, of?: number | null): string {
  if (kind === 'charger') return (of ?? 1) > 1 ? fill(t(lang, 'devices_name_charger'), { n }) : t(lang, 'devices_name_charger_single');
  if (kind === 'battery') return t(lang, 'devices_name_battery');
  if (kind === 'inverter') return t(lang, 'devices_name_inverter');
  return kind;
}

/** The sentence for a note code, or '' for a code this version does not know. */
export function deviceNote(lang: Lang, code: string | null | undefined, params: Params | undefined): string {
  if (!code) return '';
  const key = `devices_note_${code}` as StringKey;
  const template = t(lang, key);
  return template === key ? '' : fill(template, params ?? {});
}
