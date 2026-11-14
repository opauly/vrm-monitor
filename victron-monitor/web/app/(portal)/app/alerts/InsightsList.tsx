'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Input, Select } from '@/components/ui';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import styles from './alerts.module.css';

// The Insights tab. Two blocks: TODAY'S insights, always open at the top (what a notification points at: a tap on the morning push lands
// right on them), and the earlier ones from the last 14 days in a closed block below, with a search box and a kind filter for when there
// are many. All filtering happens here, on what the server already sent.

export type InsightItem = {
  id: number;
  kind: string;
  severity: 'ok' | 'warning';
  title: string;
  body: string;
  when: string;
  updated: string | null; // when the text was last brought up to date (today's outlook is refreshed through the day)
  site: string;
  today: boolean;
  href: string | null;
  linkLabel: string;
};

const PAGE = 15;
const EXPAND_TODAY_UP_TO = 5;

function InsightRow({ lang, item, open, onToggle }: { lang: Lang; item: InsightItem; open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <details
      className={`${styles.insightRow} ${item.severity === 'warning' ? styles.insightWarn : styles.insightOk}`}
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
    >
      <summary className={styles.insightSummary}>
        <span className={styles.insightTitle}>{item.title}</span>
        <span className={styles.insightWhen}>{item.when}</span>
      </summary>
      <div className={styles.insightBody}>
        {item.body && <p>{item.body}</p>}
        {item.updated && <p className={styles.insightUpdated}>{t(lang, 'insights_updated').replace('{time}', item.updated)}</p>}
        {item.href && (
          <Link href={item.href} className={styles.cardLink}>
            {item.linkLabel} →
          </Link>
        )}
      </div>
    </details>
  );
}

export function InsightsList({ lang, items }: { lang: Lang; items: InsightItem[] }) {
  const today = useMemo(() => items.filter((i) => i.today), [items]);
  const earlier = useMemo(() => items.filter((i) => !i.today), [items]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [shown, setShown] = useState(PAGE);
  // Expanded on arrival only while there are few: with dozens, one tap on a row is better than a page-long scroll.
  const [open, setOpen] = useState<Record<number, boolean>>(() =>
    today.length <= EXPAND_TODAY_UP_TO ? Object.fromEntries(today.map((i) => [i.id, true])) : {},
  );
  const setRow = (id: number) => (isOpen: boolean) => setOpen((prev) => (prev[id] === isOpen ? prev : { ...prev, [id]: isOpen }));

  const kinds = useMemo(() => [...new Set(earlier.map((i) => i.kind))], [earlier]);
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => earlier.filter((i) => (kind === 'all' || i.kind === kind) && (!needle || `${i.title} ${i.body} ${i.site}`.toLowerCase().includes(needle))),
    [earlier, kind, needle],
  );
  const visible = filtered.slice(0, shown);
  const todayAllOpen = today.length > 0 && today.every((i) => open[i.id]);
  const visibleAllOpen = visible.length > 0 && visible.every((i) => open[i.id]);

  return (
    <>
      <section className={styles.insightsToday} aria-labelledby="insights-today">
        <div className={styles.insightsTodayHead}>
          <h2 id="insights-today" className={styles.insightsTodayTitle}>{t(lang, 'insights_today_title')}</h2>
          {today.length > 0 && <span className={styles.resolvedCount}>{t(lang, 'insights_today_count').replace('{n}', String(today.length))}</span>}
          {today.length > 1 && (
            <button type="button" className={`${styles.linkButton} ${styles.insightsTodayToggle}`} onClick={() => setOpen((prev) => ({ ...prev, ...Object.fromEntries(today.map((i) => [i.id, !todayAllOpen])) }))}>
              {t(lang, todayAllOpen ? 'insights_collapse_all' : 'insights_expand_all')}
            </button>
          )}
        </div>
        {today.length === 0 ? (
          <p className={styles.empty}>{t(lang, 'insights_today_empty')}</p>
        ) : (
          <div className={styles.insightList}>
            {today.map((i) => (
              <InsightRow key={i.id} lang={lang} item={i} open={!!open[i.id]} onToggle={setRow(i.id)} />
            ))}
          </div>
        )}
      </section>

      {earlier.length > 0 && (
        // Closed until asked for, like the resolved alerts: the list can run to dozens, the count says what is inside.
        <details className={`${styles.resolvedBlock} ${styles.insightsBlock}`}>
          <summary className={styles.resolvedHead}>
            <span className={styles.sectionLabelInline}>{t(lang, 'insights_title')}</span>
            <span className={styles.resolvedCount}>{t(lang, 'insights_sent_count').replace('{n}', String(earlier.length))}</span>
          </summary>
          <div className={styles.insightControls}>
            <Input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
              placeholder={t(lang, 'insights_search')}
              aria-label={t(lang, 'insights_search')}
              className={styles.insightSearch}
            />
            <Select value={kind} onChange={(e) => { setKind(e.target.value); setShown(PAGE); }} aria-label={t(lang, 'insights_filter_kind')}>
              <option value="all">{t(lang, 'insights_all_kinds')}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(lang, `alerts_kind_${k}` as StringKey)}
                </option>
              ))}
            </Select>
            <button type="button" className={styles.linkButton} onClick={() => setOpen((prev) => ({ ...prev, ...Object.fromEntries(visible.map((i) => [i.id, !visibleAllOpen])) }))}>
              {t(lang, visibleAllOpen ? 'insights_collapse_all' : 'insights_expand_all')}
            </button>
            <span className={styles.insightCount}>{t(lang, 'insights_count').replace('{n}', String(filtered.length)).replace('{m}', String(earlier.length))}</span>
          </div>

          {filtered.length === 0 ? (
            <p className={styles.empty}>{t(lang, 'insights_no_match')}</p>
          ) : (
            <div className={styles.insightList}>
              {visible.map((i) => (
                <InsightRow key={i.id} lang={lang} item={i} open={!!open[i.id]} onToggle={setRow(i.id)} />
              ))}
            </div>
          )}

          {filtered.length > visible.length && (
            <button type="button" className={styles.showMore} onClick={() => setShown((n) => n + PAGE)}>
              {t(lang, 'insights_show_more').replace('{n}', String(filtered.length - visible.length))}
            </button>
          )}
        </details>
      )}
    </>
  );
}
