'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import type { AlertKind, AlertPreference } from '@/lib/server/db';
import { saveAlertSettingsAction, type AlertSettingsState } from './actions';
import styles from './alerts.module.css';

const INITIAL_STATE: AlertSettingsState = {};

type Props = {
  lang: Lang;
  kinds: readonly AlertKind[];
  initial: Record<AlertKind, AlertPreference>;
  email: string;
};

// One row per alert kind: "Show" (is it raised at all), "Email me" and
// "Phone" (push). Email/Phone are moot when Show is off, so those boxes are disabled then — a disabled box is
// not submitted, which the action reads as "off", the same outcome.
export function AlertSettingsForm({ lang, kinds, initial, email }: Props) {
  const [state, formAction, pending] = useActionState(saveAlertSettingsAction, INITIAL_STATE);
  const [shown, setShown] = useState<Record<string, boolean>>(Object.fromEntries(kinds.map((k) => [k, initial[k].enabled])));

  return (
    <form action={formAction} className={styles.settingsForm}>
      <div className={styles.settingsHead} aria-hidden="true">
        <span>{t(lang, 'alerts_col_alert')}</span>
        <span>{t(lang, 'alerts_col_show')}</span>
        <span>{t(lang, 'alerts_col_email')}</span>
        <span>{t(lang, 'alerts_col_push')}</span>
      </div>

      {kinds.map((kind) => (
        <div key={kind} className={styles.settingsRow}>
          <div>
            <div className={styles.kindName}>{t(lang, `alerts_kind_${kind}`)}</div>
            <div className={styles.kindDesc}>{t(lang, `alerts_kind_${kind}_desc`)}</div>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              name={`enabled_${kind}`}
              checked={shown[kind]}
              onChange={(e) => setShown((prev) => ({ ...prev, [kind]: e.target.checked }))}
              disabled={pending}
            />
            <span className={styles.toggleLabel}>{t(lang, 'alerts_col_show')}</span>
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" name={`email_${kind}`} defaultChecked={initial[kind].email} disabled={pending || !shown[kind]} />
            <span className={styles.toggleLabel}>{t(lang, 'alerts_col_email')}</span>
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" name={`push_${kind}`} defaultChecked={initial[kind].push} disabled={pending || !shown[kind]} />
            <span className={styles.toggleLabel}>{t(lang, 'alerts_col_push')}</span>
          </label>
        </div>
      ))}

      <p className={styles.emailNote}>{t(lang, 'alerts_settings_email_to').replace('{email}', email)}</p>

      <div className={styles.formActions}>
        <Button type="submit" disabled={pending}>
          {t(lang, 'alerts_save')}
        </Button>
        {state.success && <span className={styles.saved} role="status">{t(lang, 'alerts_saved')}</span>}
        {state.error && <span className={styles.error} role="alert">{state.error}</span>}
      </div>
    </form>
  );
}
