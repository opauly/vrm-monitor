'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import type { AlertPreference, PreferenceKind } from '@/lib/server/db';
import type { AlertSettingsState } from './actions';
import styles from './alerts.module.css';

const INITIAL_STATE: AlertSettingsState = {};

type Props = {
  lang: Lang;
  /** Alert kinds and insight kinds are shown as two groups, each with its own heading. */
  groups: { title: string; description: string; kinds: readonly PreferenceKind[] }[];
  initial: Record<PreferenceKind, AlertPreference>;
  email: string;
  /** Who the preferences are saved for is decided by this server action, from the session — never by the form. */
  action: (prev: AlertSettingsState, formData: FormData) => Promise<AlertSettingsState>;
};

// One row per alert kind: "Show" (is it raised at all), "Email me" and
// "Phone" (push). Email/Phone are moot when Show is off, so those boxes are disabled then — a disabled box is
// not submitted, which the action reads as "off", the same outcome.
export function AlertSettingsForm({ lang, groups, initial, email, action }: Props) {
  const kinds = groups.flatMap((g) => g.kinds);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [shown, setShown] = useState<Record<string, boolean>>(Object.fromEntries(kinds.map((k) => [k, initial[k].enabled])));

  return (
    <form action={formAction} className={styles.settingsForm}>
      {groups.map((group) => (
        <div key={group.title} className={styles.settingsGroup}>
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{group.title}</h3>
        <p className={styles.groupDesc}>{group.description}</p>
      </div>
      <div className={styles.settingsHead} aria-hidden="true">
        <span>{t(lang, 'alerts_col_alert')}</span>
        <span>{t(lang, 'alerts_col_show')}</span>
        <span>{t(lang, 'alerts_col_email')}</span>
        <span>{t(lang, 'alerts_col_push')}</span>
      </div>

      {group.kinds.map((kind) => (
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
