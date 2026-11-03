'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Input, Select } from '@/components/ui';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import styles from './alerts.module.css';

// The Insights tab's list: each insight is a row that opens to its full text, with a search box and a kind filter for when
// there are many, and the oldest hidden behind "Show more". All filtering happens here, on what the server already sent.

export type InsightItem = {
  id: number;
  kind: string;
  severity: 'ok' | 'warning';
  title: string;
  body: string;
  when: string;
  site: string;
  href: string | null;
  linkLabel: string;
};

const PAGE = 15;

export function InsightsList({ lang, items }: { lang: Lang; items: InsightItem[] }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const kinds = useMemo(() => [...new Set(items.map((i) => i.kind))], [items]);
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => items.filter((i) => (kind === 'all' || i.kind === kind) && (!needle || `${i.title} ${i.body} ${i.site}`.toLowerCase().includes(needle))),
    [items, kind, needle],
  );
  const visible = filtered.slice(0, shown);
  const allOpen = visible.length > 0 && visible.every((i) => open[i.id]);

  return (
    <div>
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
        <button type="button" className={styles.linkButton} onClick={() => setOpen(Object.fromEntries(visible.map((i) => [i.id, !allOpen])))}>
          {t(lang, allOpen ? 'insights_collapse_all' : 'insights_expand_all')}
        </button>
        <span className={styles.insightCount}>{t(lang, 'insights_count').replace('{n}', String(filtered.length)).replace('{m}', String(items.length))}</span>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'insights_no_match')}</p>
      ) : (
        <div className={styles.insightList}>
          {visible.map((i) => (
            <details
              key={i.id}
              className={`${styles.insightRow} ${i.severity === 'warning' ? styles.insightWarn : styles.insightOk}`}
              open={!!open[i.id]}
              onToggle={(e) => setOpen((prev) => ({ ...prev, [i.id]: (e.currentTarget as HTMLDetailsElement).open }))}
            >
              <summary className={styles.insightSummary}>
                <span className={styles.insightTitle}>{i.title}</span>
                <span className={styles.insightWhen}>{i.when}</span>
              </summary>
              <div className={styles.insightBody}>
                {i.body && <p>{i.body}</p>}
                {i.href && (
                  <Link href={i.href} className={styles.cardLink}>
                    {i.linkLabel} →
                  </Link>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      {filtered.length > visible.length && (
        <button type="button" className={styles.showMore} onClick={() => setShown((n) => n + PAGE)}>
          {t(lang, 'insights_show_more').replace('{n}', String(filtered.length - visible.length))}
        </button>
      )}
    </div>
  );
}
