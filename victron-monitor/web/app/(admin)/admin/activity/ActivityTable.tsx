'use client';

import { Fragment, useState } from 'react';
import { Table } from '@/components/ui';
import { formatDateTime } from '@/lib/dates';
import type { IngestionLogRecord } from '@/lib/server/db';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './activity.module.css';

function warningMessages(warnings: unknown): string[] {
  if (!warnings) return [];
  if (Array.isArray(warnings)) return warnings.map(String);
  const messages = (warnings as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages.map(String) : [];
}

/** `warnings.days_replacing_csv` (`victron/ingest.py:ingest_parsed()`, §5.4)
 * — how many days this ingestion overwrote that a CSV upload had
 * previously written for the same site. Pulled out as its own visible
 * column rather than left buried inside the generic "Warnings" expand
 * (PLAN_PHASE15.md §8 Step 6: "days_replacing_csv visible" — the whole
 * point is that a mixed-source site's report changing isn't a mystery). */
function daysReplacingCsv(warnings: unknown): number {
  if (!warnings || typeof warnings !== 'object') return 0;
  const n = (warnings as { days_replacing_csv?: unknown }).days_replacing_csv;
  return typeof n === 'number' ? n : 0;
}

export function ActivityTable({
  ingestions,
  customerNameBySite,
  displayNameBySite,
  lang,
}: {
  ingestions: IngestionLogRecord[];
  customerNameBySite: Record<string, string>;
  displayNameBySite: Record<string, string>;
  lang: Lang;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  if (ingestions.length === 0) {
    return <p className={styles.empty}>{t(lang, 'admin_activity_no_uploads')}</p>;
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t(lang, 'admin_activity_col_customer')}</th>
          <th>{t(lang, 'admin_sites_col_site')}</th>
          <th>{t(lang, 'admin_upload_col_hist_file')}</th>
          <th>{t(lang, 'admin_sites_col_source')}</th>
          <th>{t(lang, 'admin_activity_col_period')}</th>
          <th>{t(lang, 'admin_upload_stat_days')}</th>
          <th>{t(lang, 'admin_activity_col_csv_replaced')}</th>
          <th>{t(lang, 'admin_upload_col_hist_alarms')}</th>
          <th>{t(lang, 'admin_upload_warnings_label')}</th>
          <th>{t(lang, 'admin_upload_col_hist_uploaded')}</th>
        </tr>
      </thead>
      <tbody>
        {ingestions.map((log) => {
          const warnings = warningMessages(log.warnings);
          const replacedDays = daysReplacingCsv(log.warnings);
          return (
            <Fragment key={log.id}>
              <tr>
                <td>{customerNameBySite[log.site_id] ?? '—'}</td>
                <td>{displayNameBySite[log.site_id] ?? log.site_id}</td>
                <td>{log.filename ?? '—'}</td>
                <td className="mono">{log.source}</td>
                <td>
                  {log.period_start?.slice(0, 10) ?? '—'} → {log.period_end?.slice(0, 10) ?? '—'}
                </td>
                <td>{log.rows_written ?? '—'}</td>
                <td>{replacedDays > 0 ? <span className={styles.replacedBadge}>{replacedDays}</span> : 0}</td>
                <td>{log.alarm_events_written ?? '—'}</td>
                <td>
                  {warnings.length > 0 ? (
                    <button type="button" className={styles.expandButton} onClick={() => setExpanded((e) => ({ ...e, [log.id]: !e[log.id] }))}>
                      {warnings.length} {expanded[log.id] ? '▲' : '▼'}
                    </button>
                  ) : (
                    0
                  )}
                </td>
                <td>{formatDateTime(log.uploaded_at)}</td>
              </tr>
              {expanded[log.id] && warnings.length > 0 && (
                <tr>
                  <td colSpan={10} className={styles.warningsRow}>
                    <ul>
                      {warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}
