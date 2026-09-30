'use client';

// Table + notify-email setting + row triage for `/admin/feedback`
// (PLAN_BETA_PROGRAM.md § Phase 8) — same shape `../customers/
// CustomersManager.tsx`/`../beta/BetaManager.tsx` already establish: a
// filter row over a client-side-filtered full fetch, row actions invoked
// directly from `onClick`/`onChange` inside `startTransition`, and an
// expandable detail row following `../activity/ActivityTable.tsx`'s own
// toggle pattern.
import { Fragment, startTransition, useActionState, useState } from 'react';
import { Button, Field, Input, Select, Table, Textarea } from '@/components/ui';
import { formatDateTime } from '@/lib/dates';
import type { AdminFeedbackRow } from '@/lib/server/db/admin';
import type { FeedbackKind, FeedbackPriority, FeedbackStatus } from '@/lib/server/db/types';
import { t, type Lang } from '@/lib/i18n/strings';
import {
  getFeedbackScreenshotUrlAction,
  saveFeedbackNotifyEmailAction,
  updateFeedbackAction,
  type SaveNotifyEmailState,
} from './actions';
import styles from './feedback.module.css';

const TABLE_COLUMN_COUNT = 7;

type KindFilter = 'all' | FeedbackKind;
type StatusFilter = 'all' | FeedbackStatus;
type SeverityFilter = 'all' | 'low' | 'medium' | 'high' | 'blocker';

function statusBadgeClass(status: FeedbackStatus): string {
  if (status === 'new') return styles.statusNew;
  if (status === 'triaged' || status === 'in_progress') return styles.statusActive;
  if (status === 'resolved') return styles.statusResolved;
  return styles.statusClosed; // wont_fix, duplicate
}

function NotifyEmailSetting({ notifyEmail, lang }: { notifyEmail: string; lang: Lang }) {
  const [state, formAction, pending] = useActionState<SaveNotifyEmailState, FormData>(saveFeedbackNotifyEmailAction, {});
  // `value` is a controlled input already holding exactly what was just
  // submitted — no need to sync it back FROM `state.email` after a save,
  // so there's no effect here at all (unlike FeedbackWidget.tsx's own
  // `formRef.current?.reset()`, which really does need one — that's a real
  // external DOM node this state doesn't already describe).
  const [value, setValue] = useState(notifyEmail);

  return (
    <form action={formAction} className={styles.notifyRow}>
      <Field label={t(lang, 'admin_feedback_notify_email_label')} htmlFor="fb-notify-email">
        <Input id="fb-notify-email" name="email" type="email" value={value} onChange={(e) => setValue(e.target.value)} disabled={pending} required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? t(lang, 'admin_common_saving') : t(lang, 'admin_common_save')}
      </Button>
      {state.ok && <span className={styles.success}>{t(lang, 'admin_feedback_notify_email_saved')}</span>}
      {state.error && <span className={styles.error}>{state.error}</span>}
    </form>
  );
}

function ScreenshotButton({ path, lang }: { path: string; lang: Lang }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const result = await getFeedbackScreenshotUrlAction(path);
      setBusy(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer');
    });
  }

  return (
    <div>
      <Button type="button" variant="ghost" onClick={open} disabled={busy}>
        {busy ? t(lang, 'admin_feedback_screenshot_opening') : t(lang, 'admin_feedback_view_screenshot')}
      </Button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function FeedbackDetailRow({ item, lang }: { item: AdminFeedbackRow; lang: Lang }) {
  const [notes, setNotes] = useState(item.admin_notes ?? '');
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesSaved, setNotesSaved] = useState(false);

  function saveNotes() {
    setNotesBusy(true);
    setNotesError(null);
    setNotesSaved(false);
    startTransition(async () => {
      const result = await updateFeedbackAction(item.id, { admin_notes: notes });
      setNotesBusy(false);
      if (result.error) {
        setNotesError(result.error);
        return;
      }
      setNotesSaved(true);
    });
  }

  return (
    <tr>
      <td colSpan={TABLE_COLUMN_COUNT} className={styles.detailRow}>
        <p className={styles.detailBody}>{item.body}</p>
        <div className={styles.detailMeta}>
          <span>{t(lang, 'admin_feedback_detail_page')}: {item.page_path ?? '—'}</span>
          <span>{t(lang, 'admin_feedback_detail_site')}: {item.site_id ?? '—'}</span>
          <span>{t(lang, 'admin_feedback_detail_email')}: {item.submitter_email}</span>
          <span>{t(lang, 'admin_feedback_detail_language')}: {item.ui_language ?? '—'}</span>
          <span>{t(lang, 'admin_feedback_detail_app_version')}: {item.app_version ?? '—'}</span>
        </div>
        <p className={styles.detailUserAgent}>{item.user_agent ?? '—'}</p>
        {item.screenshot_path && <ScreenshotButton path={item.screenshot_path} lang={lang} />}

        <Field label={t(lang, 'admin_feedback_field_notes')} htmlFor={`fb-notes-${item.id}`}>
          <Textarea id={`fb-notes-${item.id}`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={notesBusy} />
        </Field>
        <div className={styles.formActions}>
          <Button type="button" variant="ghost" onClick={saveNotes} disabled={notesBusy}>
            {notesBusy ? t(lang, 'admin_common_saving') : t(lang, 'admin_common_save')}
          </Button>
          {notesSaved && <span className={styles.success}>{t(lang, 'admin_common_saved')}</span>}
        </div>
        {notesError && <p className={styles.error}>{notesError}</p>}
      </td>
    </tr>
  );
}

export function FeedbackManager({ feedback, notifyEmail, lang }: { feedback: AdminFeedbackRow[]; notifyEmail: string; lang: Lang }) {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = feedback.filter((f) => {
    if (kindFilter !== 'all' && f.kind !== kindFilter) return false;
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    if (normalizedQuery) {
      const haystack = [f.customerName, f.title, f.body, f.submitter_email].join(' ').toLowerCase();
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });

  function runFieldUpdate(id: string, fields: Parameters<typeof updateFeedbackAction>[1]) {
    setRowBusy((b) => ({ ...b, [id]: true }));
    setRowError((e) => ({ ...e, [id]: '' }));
    startTransition(async () => {
      const result = await updateFeedbackAction(id, fields);
      setRowBusy((b) => ({ ...b, [id]: false }));
      if (result.error) setRowError((e) => ({ ...e, [id]: result.error! }));
    });
  }

  return (
    <div>
      <NotifyEmailSetting notifyEmail={notifyEmail} lang={lang} />

      <div className={styles.filtersRow}>
        <label className={styles.filterLabel}>
          {t(lang, 'admin_feedback_filter_kind')}
          <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)}>
            <option value="all">{t(lang, 'admin_common_all')}</option>
            <option value="bug">{t(lang, 'feedback_kind_bug')}</option>
            <option value="suggestion">{t(lang, 'feedback_kind_suggestion')}</option>
          </Select>
        </label>
        <label className={styles.filterLabel}>
          {t(lang, 'admin_feedback_filter_status')}
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">{t(lang, 'admin_common_all')}</option>
            <option value="new">{t(lang, 'admin_feedback_status_new')}</option>
            <option value="triaged">{t(lang, 'admin_feedback_status_triaged')}</option>
            <option value="in_progress">{t(lang, 'admin_feedback_status_in_progress')}</option>
            <option value="resolved">{t(lang, 'admin_feedback_status_resolved')}</option>
            <option value="wont_fix">{t(lang, 'admin_feedback_status_wont_fix')}</option>
            <option value="duplicate">{t(lang, 'admin_feedback_status_duplicate')}</option>
          </Select>
        </label>
        <label className={styles.filterLabel}>
          {t(lang, 'admin_feedback_filter_severity')}
          <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}>
            <option value="all">{t(lang, 'admin_common_all')}</option>
            <option value="low">{t(lang, 'feedback_severity_low')}</option>
            <option value="medium">{t(lang, 'feedback_severity_medium')}</option>
            <option value="high">{t(lang, 'feedback_severity_high')}</option>
            <option value="blocker">{t(lang, 'feedback_severity_blocker')}</option>
          </Select>
        </label>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(lang, 'admin_search_placeholder')} className={styles.searchBox} />
        <span className={styles.filterCount}>
          {t(lang, 'admin_feedback_filter_count').replace('{n}', String(filtered.length)).replace('{m}', String(feedback.length))}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'admin_search_no_results')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t(lang, 'admin_feedback_col_customer')}</th>
              <th>{t(lang, 'admin_feedback_col_type')}</th>
              <th>{t(lang, 'admin_feedback_col_title')}</th>
              <th>{t(lang, 'admin_feedback_col_status')}</th>
              <th>{t(lang, 'admin_feedback_col_priority')}</th>
              <th>{t(lang, 'admin_feedback_col_created')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <Fragment key={item.id}>
                <tr>
                  <td>{item.customerName}</td>
                  <td>
                    {item.kind === 'bug' ? t(lang, 'feedback_kind_bug') : t(lang, 'feedback_kind_suggestion')}
                    {item.severity && <div className={styles.subtle}>{t(lang, `feedback_severity_${item.severity}` as const)}</div>}
                  </td>
                  <td>{item.title}</td>
                  <td>
                    <span className={statusBadgeClass(item.status)}>{t(lang, `admin_feedback_status_${item.status}` as const)}</span>
                    {rowError[item.id] && <div className={styles.rowError}>{rowError[item.id]}</div>}
                  </td>
                  <td>
                    <Select
                      value={item.admin_priority ?? ''}
                      disabled={rowBusy[item.id]}
                      onChange={(e) => runFieldUpdate(item.id, { admin_priority: (e.target.value || null) as FeedbackPriority | null })}
                    >
                      <option value="">—</option>
                      <option value="p1">P1</option>
                      <option value="p2">P2</option>
                      <option value="p3">P3</option>
                    </Select>
                  </td>
                  <td>{formatDateTime(item.created_at)}</td>
                  <td className={styles.actionsCell}>
                    <Select
                      value={item.status}
                      disabled={rowBusy[item.id]}
                      onChange={(e) => runFieldUpdate(item.id, { status: e.target.value as FeedbackStatus })}
                    >
                      <option value="new">{t(lang, 'admin_feedback_status_new')}</option>
                      <option value="triaged">{t(lang, 'admin_feedback_status_triaged')}</option>
                      <option value="in_progress">{t(lang, 'admin_feedback_status_in_progress')}</option>
                      <option value="resolved">{t(lang, 'admin_feedback_status_resolved')}</option>
                      <option value="wont_fix">{t(lang, 'admin_feedback_status_wont_fix')}</option>
                      <option value="duplicate">{t(lang, 'admin_feedback_status_duplicate')}</option>
                    </Select>
                    <Button type="button" variant="ghost" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                      {expandedId === item.id ? '▲' : '▼'}
                    </Button>
                  </td>
                </tr>
                {expandedId === item.id && <FeedbackDetailRow item={item} lang={lang} />}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
