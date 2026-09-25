'use client';

// `/admin/activity`'s recent-runs panel + "Run due now" button
// (PLAN_PHASE17.md §3.7, §8 Step 7) — the detection surface for "the
// scheduled-reports cron silently stopped" (§0.5's own named failure mode:
// GitHub Actions scheduled workflows are best-effort and get disabled
// outright after 60 days of repo inactivity). "Run due now" hits
// `POST /api/admin/pipeline/reports/run-due`, the same
// `requireAdminForRoute()`-gated proxy pattern every other
// `app/api/admin/pipeline/*` route uses (see that route's own header
// comment) — `router.refresh()` afterward re-fetches this table's own
// Server Component data, the same convention `VrmFleetManager.tsx` already
// uses after a sync completes.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Table } from '@/components/ui';
import { formatDateTime } from '@/lib/dates';
import type { ReportRunRecord } from '@/lib/server/db';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './activity.module.css';

function statusClassName(status: string): string {
  if (status === 'done') return styles.appliedBadge;
  if (status === 'failed' || status === 'abandoned' || status === 'skipped_capped' || status === 'skipped_not_entitled') {
    return styles.forgedBadge;
  }
  return styles.subtleBadge;
}

export function ReportRunsTable({
  runs,
  customerNameById,
  displayNameBySite,
  lang,
}: {
  runs: ReportRunRecord[];
  customerNameById: Record<string, string>;
  displayNameBySite: Record<string, string>;
  lang: Lang;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRunDue() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/pipeline/reports/run-due', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError(t(lang, 'admin_activity_err_run_due'));
        return;
      }
      const data = (await res.json()) as { sites_checked: number; processed: number; remaining: number };
      const base = t(lang, 'admin_activity_run_result').replace('{checked}', String(data.sites_checked)).replace('{processed}', String(data.processed));
      const suffix = data.remaining > 0 ? t(lang, 'admin_activity_run_remaining_suffix').replace('{remaining}', String(data.remaining)) : '';
      setResult(base + suffix);
      router.refresh();
    } catch {
      setError(t(lang, 'admin_activity_err_reach_report_service'));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Button type="button" variant="ghost" onClick={handleRunDue} disabled={running}>
          {running ? t(lang, 'admin_activity_running_label') : t(lang, 'admin_activity_run_due_button')}
        </Button>
        {result && <span className={styles.subtle}>{result}</span>}
      </div>
      {error && <p className={styles.forgedBadge}>{error}</p>}

      {runs.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'admin_activity_no_report_runs')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t(lang, 'admin_activity_col_run_at')}</th>
              <th>{t(lang, 'admin_activity_col_customer')}</th>
              <th>{t(lang, 'admin_sites_col_site')}</th>
              <th>{t(lang, 'admin_activity_col_trigger')}</th>
              <th>{t(lang, 'admin_activity_col_period')}</th>
              <th>{t(lang, 'admin_activity_col_status')}</th>
              <th>{t(lang, 'admin_activity_col_error')}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{formatDateTime(run.created_at)}</td>
                <td>{customerNameById[run.customer_id] ?? run.customer_id}</td>
                <td>{displayNameBySite[run.site_id] ?? run.site_id}</td>
                <td className="mono">{run.trigger}</td>
                <td>
                  {run.period_start} → {run.period_end}
                </td>
                <td>
                  <span className={statusClassName(run.status)}>{run.status}</span>
                </td>
                <td className={styles.subtle}>{run.error ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
