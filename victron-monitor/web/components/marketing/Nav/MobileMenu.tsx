'use client';

// Mobile stand-in for `.links` below 920px (2026-09-24) — `.links` itself
// just `display: none`s at that breakpoint with nothing replacing it,
// silently dropping every nav link AND the Log in/Sign up buttons for any
// visitor on a phone. This renders a hamburger button and a slide-down
// panel instead: the desktop "How it works" hover-dropdown is flattened
// into plain stacked links (hover has no touch equivalent), and `NavAuthArea`
// is reused unchanged so the authenticated/anonymous state stays identical
// between the desktop and mobile renders — no second source of truth for
// "is someone signed in."
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NavAuthArea } from './NavAuthArea';
import styles from './Nav.module.css';

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  // Same outside-click / Escape pattern `AccountMenu` already uses — kept
  // independent of it rather than shared, since that dropdown can itself be
  // open INSIDE this panel (signed-in visitor) and needs its own outside
  // click not to also close this outer panel via bubbling.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.mobileMenu} ref={wrapRef}>
      <button
        type="button"
        className={styles.hamburger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <span className={styles.hamburgerBar} aria-hidden="true" />
        <span className={styles.hamburgerBar} aria-hidden="true" />
        <span className={styles.hamburgerBar} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.mobilePanel} role="menu">
          <div className={styles.mobileGroupLabel}>How it works</div>
          <Link href="/#how" role="menuitem" onClick={close}>
            Overview
          </Link>
          <Link href="/#integrator" role="menuitem" onClick={close}>
            Why Victron-recommended
          </Link>
          <Link href="/#capabilities" role="menuitem" onClick={close}>
            Dashboard &amp; reports
          </Link>
          <Link href="/whats-inside" role="menuitem" className={styles.mobileTopLink} onClick={close}>
            What&apos;s inside
          </Link>
          <Link href="/#pricing" role="menuitem" className={styles.mobileTopLink} onClick={close}>
            Pricing
          </Link>
          <div className={styles.mobileAuth}>
            <NavAuthArea />
          </div>
        </div>
      )}
    </div>
  );
}
