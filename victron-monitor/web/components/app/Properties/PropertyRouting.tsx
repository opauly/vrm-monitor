'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Input, Panel } from '@/components/ui';
import { deviceLabel } from '@/lib/deviceLabel';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './PropertyRouting.module.css';

// "Who gets what, by property": under the account's own email and phones, a property can have extra email recipients (its owner, a
// technician) and a phone can be limited to some properties. Every change calls a Server Action that re-checks who is asking.

export type RoutingResult = { ok: boolean; error?: 'invalid_email' | 'too_many' | 'failed' };

export type RoutingActions = {
  addRecipient: (propertyId: string, email: string) => Promise<RoutingResult>;
  removeRecipient: (recipientId: number) => Promise<RoutingResult>;
  setDeviceScope: (deviceId: number, propertyIds: string[] | null) => Promise<RoutingResult>;
};

type Props = {
  lang: Lang;
  properties: { id: string; name: string }[];
  recipients: { id: number; property_id: string; email: string }[];
  devices: { id: number; user_agent: string | null; created_at: string; property_ids: string[] | null }[];
  actions: RoutingActions;
};

function RecipientsRow({ lang, property, recipients, actions, busy, run }: {
  lang: Lang; property: { id: string; name: string }; recipients: Props['recipients']; actions: RoutingActions; busy: boolean;
  run: (job: () => Promise<RoutingResult>, after?: () => void) => void;
}) {
  const [email, setEmail] = useState('');
  return (
    <li className={styles.property}>
      <div className={styles.propertyName}>{property.name}</div>
      <div className={styles.chips}>
        {recipients.length === 0 && <span className={styles.none}>{t(lang, 'routing_no_recipients')}</span>}
        {recipients.map((r) => (
          <span key={r.id} className={styles.chip}>
            {r.email}
            <button type="button" className={styles.remove} disabled={busy} aria-label={`${t(lang, 'routing_remove')} ${r.email}`} onClick={() => run(() => actions.removeRecipient(r.id))}>×</button>
          </span>
        ))}
      </div>
      <form
        className={styles.addRow}
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) run(() => actions.addRecipient(property.id, email), () => setEmail(''));
        }}
      >
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t(lang, 'routing_add_placeholder')} aria-label={`${t(lang, 'routing_add_placeholder')} — ${property.name}`} disabled={busy} />
        <Button type="submit" variant="ghost" disabled={busy || !email.trim()}>{t(lang, 'routing_add')}</Button>
      </form>
    </li>
  );
}

export function PropertyRouting({ lang, properties, recipients, devices, actions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (job: () => Promise<RoutingResult>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await job();
      if (!result.ok) setError(t(lang, result.error === 'invalid_email' ? 'routing_error_email' : result.error === 'too_many' ? 'routing_error_many' : 'routing_error'));
      else {
        after?.();
        router.refresh();
      }
    });
  };

  if (properties.length === 0) return null;
  return (
    <>
      <h2 className={styles.sectionLabel}>{t(lang, 'routing_title')}</h2>
      <Panel>
        <p className={styles.intro}>{t(lang, 'routing_intro')}</p>

        <h3 className={styles.subhead}>{t(lang, 'routing_emails_title')}</h3>
        <p className={styles.hint}>{t(lang, 'routing_emails_hint')}</p>
        <ul className={styles.list}>
          {properties.map((p) => (
            <RecipientsRow key={p.id} lang={lang} property={p} recipients={recipients.filter((r) => r.property_id === p.id)} actions={actions} busy={pending} run={run} />
          ))}
        </ul>

        <h3 className={styles.subhead}>{t(lang, 'routing_phones_title')}</h3>
        <p className={styles.hint}>{t(lang, 'routing_phones_hint')}</p>
        {devices.length === 0 ? (
          <p className={styles.none}>{t(lang, 'routing_no_phones')}</p>
        ) : (
          <ul className={styles.list}>
            {devices.map((d) => {
              const scoped = d.property_ids !== null && d.property_ids.length > 0;
              const picked = new Set(d.property_ids ?? []);
              return (
                <li key={d.id} className={styles.property}>
                  <div className={styles.propertyName}>
                    {deviceLabel(d.user_agent)} <span className={styles.none}>{t(lang, 'routing_added').replace('{date}', d.created_at.slice(0, 10))}</span>
                  </div>
                  <label className={styles.radio}>
                    <input type="radio" name={`scope-${d.id}`} checked={!scoped} disabled={pending} onChange={() => run(() => actions.setDeviceScope(d.id, null))} />
                    {t(lang, 'routing_phone_all')}
                  </label>
                  <label className={styles.radio}>
                    <input type="radio" name={`scope-${d.id}`} checked={scoped} disabled={pending} onChange={() => run(() => actions.setDeviceScope(d.id, [properties[0].id]))} />
                    {t(lang, 'routing_phone_selected')}
                  </label>
                  {scoped && (
                    <div className={styles.checks}>
                      {properties.map((p) => (
                        <label key={p.id} className={styles.check}>
                          <input
                            type="checkbox"
                            checked={picked.has(p.id)}
                            disabled={pending || (picked.has(p.id) && picked.size === 1)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(p.id);
                              else next.delete(p.id);
                              run(() => actions.setDeviceScope(d.id, [...next]));
                            }}
                          />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </Panel>
    </>
  );
}
