'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './InfoTooltip.module.css';

export type InfoTooltipProps = {
  /** Accessible name for the trigger button — what a screen reader
   * announces, not shown visually. */
  label: string;
  children: ReactNode;
  className?: string;
};

// Small "(i)" trigger + popover, for explaining a number in place rather
// than sending the reader to a help page. Opens on hover (desktop) and on
// click (touch, and desktop users who prefer it) — 2026-09-19, added for
// the System/Grid score cards so a customer can see WHY a score landed
// where it did, not just the bare number.
//
// Every click handler calls stopPropagation()/preventDefault(): several
// call sites nest this inside a <summary> (the rollup cards' own
// <details> disclosure), and without stopping propagation, tapping the
// icon would also toggle that parent panel open/closed — the native
// "clicking a summary's descendant still triggers the summary" behavior,
// same reasoning IntegratorBadge's own outbound-link click doesn't need
// (it has no disclosure ancestor to fight).
export function InfoTooltip({ label, children, className }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const classes = [styles.wrap, className].filter(Boolean).join(' ');

  return (
    <span className={classes} ref={wrapRef}>
      <button
        type="button"
        className={styles.icon}
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Sets true rather than toggling — a real mouse click always
          // fires `mouseenter` first, which already opened this via
          // hover, so a toggle would immediately close what hover just
          // opened (caught live: click appeared to do nothing on
          // desktop). Touch has no hover event at all, so a tap here is
          // the only thing that opens it there; closing happens via the
          // outside-click/Escape handlers below, not a second tap on
          // the icon itself.
          setOpen(true);
        }}
      >
        i
      </button>
      {open && (
        <span
          className={styles.bubble}
          role="tooltip"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
