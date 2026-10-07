import { listOpenAdminAlerts, listRecentResolvedAdminAlerts, type AdminAlert } from '@/lib/server/db';
import { describeAdminAlert } from '@/lib/adminAlertText';
import { formatDateTimeInZone } from '@/lib/dates';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from '@/app/(portal)/app/alerts/alerts.module.css';

// "System health" at the top of /admin/fleet/alerts: the alerts about the
// monitor itself (vrm.admin_alerts) — sweep stopped, history behind, many sites
// silent at once, VRM unreadable. Same card look as the customer alerts below it.

function AdminAlertCard({ alert, lang, resolved }: { alert: AdminAlert; lang: Lang; resolved: boolean }) {
  const { title, body } = describeAdminAlert(lang, alert);
  const stamp = resolved ? alert.resolved_at : alert.opened_at;
  const when = stamp ? formatDateTimeInZone(stamp, null, 'en-US') : '—';
  const tone = resolved ? styles.cardResolved : alert.severity === 'critical' ? styles.cardCritical : styles.cardWarning;
  return (
    <article className={`${styles.card} ${tone}`}>
      {!resolved && <div className={styles.severity}>{t(lang, alert.severity === 'critical' ? 'alerts_severity_critical' : 'alerts_severity_warning')}</div>}
      <h3 className={styles.cardTitle}>{title}</h3>
      {!resolved && <p className={styles.cardBody}>{body}</p>}
      <div className={styles.meta}>
        <span>{t(lang, resolved ? 'alerts_resolved_at' : 'alerts_since').replace('{time}', when)}</span>
      </div>
    </article>
  );
}

export async function AdminHealthSection({ lang }: { lang: Lang }) {
  const [open, recent] = await Promise.all([listOpenAdminAlerts(), listRecentResolvedAdminAlerts()]);
  return (
    <section>
      <h2 className={styles.sectionLabel}>{t(lang, 'admin_alerts_title')}</h2>
      <p className={styles.intro}>{t(lang, 'admin_alerts_intro')}</p>
      {open.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'admin_alerts_ok')}</p>
      ) : (
        <div className={styles.cards}>
          {open.map((a) => (
            <AdminAlertCard key={a.id} alert={a} lang={lang} resolved={false} />
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <>
          <h3 className={styles.sectionLabel}>{t(lang, 'admin_alerts_recent')}</h3>
          <div className={styles.cards}>
            {recent.map((a) => (
              <AdminAlertCard key={a.id} alert={a} lang={lang} resolved />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
