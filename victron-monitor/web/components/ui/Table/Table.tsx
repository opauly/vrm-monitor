'use client';

import { useEffect, useRef, type ReactNode, type TableHTMLAttributes } from 'react';
import styles from './Table.module.css';

// Not extracted from `landing_template.html` — the marketing page never
// renders a data table, so there's nothing there for this to be a
// near-verbatim move of (unlike Button/Panel/Stat/Field, which are moves of
// existing rules per PLAN_PHASE14.md §1.7). This is a new primitive, built
// from the same tokens (`--panel`, `--line`, `--mute`, `--font-mono`
// eyebrow-style headers) so a dashboard table reads as the same instrument
// panel the marketing components already establish — first real table this
// app needs is `app/(portal)/app/sites`'s site list (§2 Step 4).
//
// Phone layout: below 720px every row becomes a stacked card (see
// Table.module.css) — a 6–9 column table either scrolls sideways with its
// actions out of sight, or crushes every column to a few characters. A card
// needs each cell to know its column heading, so the effect below copies
// each `<th>`'s text onto the matching `<td>` as `data-label`. Done in the
// DOM rather than by every caller threading labels through its own rows
// (16 tables, several rendering rows dynamically), and re-run by a
// MutationObserver because the managers filter/expand rows client-side.
// Only `childList` is observed, never attributes, so writing the labels
// can't retrigger it.

export type TableProps = { children: ReactNode; className?: string } & Omit<
  TableHTMLAttributes<HTMLTableElement>,
  'className' | 'children'
>;

export function Table({ children, className, ...rest }: TableProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const applyLabels = () => {
      const labels = Array.from(wrap.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
      for (const row of Array.from(wrap.querySelectorAll('tbody tr'))) {
        Array.from(row.children).forEach((cell, index) => {
          if (!(cell instanceof HTMLElement)) return;
          // A cell spanning columns (an expanded detail row) has no single
          // heading to carry.
          const label = cell.hasAttribute('colspan') ? '' : (labels[index] ?? '');
          if (cell.dataset.label !== label) cell.dataset.label = label;
        });
      }
    };

    applyLabels();
    const observer = new MutationObserver(applyLabels);
    observer.observe(wrap, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const classes = [styles.wrap, className].filter(Boolean).join(' ');
  return (
    <div className={classes} ref={wrapRef}>
      <table className={styles.table} {...rest}>
        {children}
      </table>
    </div>
  );
}
