'use client';

// The one avatar + dropdown account menu, shared by every chrome that shows
// a signed-in identity (2026-09-08): the marketing nav's `NavAuthArea`
// (session detected client-side, since that page is ISR-cached) and the
// in-app `AppShell` header (role/email already known server-side, no fetch
// needed) both render this directly — same look, same interaction, so
// "signed in" reads identically whether you're still on the marketing site
// or already inside `/app`/`/admin`. `items` is deliberately just the
// EXTRA links each caller wants above the always-present Log out — inside
// the app itself there's usually nothing to add (Profile/Help are already
// real nav tabs there), while the marketing nav's version links back INTO
// the app.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { signOutAction } from '@/lib/server/auth-actions';
import styles from './AccountMenu.module.css';

export type AccountMenuLink = { href: string; label: string };

/** The Profile window: the menu's "Profile" entry opens `content` (server-rendered by the caller) in a dialog over the page. */
export type AccountProfile = { label: string; title: string; closeLabel: string; content: ReactNode };

export function AccountMenu({ email, items = [], profile }: { email: string; items?: AccountMenuLink[]; profile?: AccountProfile }) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [profileOpen]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initial = email.charAt(0).toUpperCase() || '?';

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu — signed in as ${email}`}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initial}
        </span>
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuEmail}>{email}</div>
          {profile && (
            <button type="button" className={styles.menuItemButton} role="menuitem" onClick={() => { setOpen(false); setProfileOpen(true); }}>
              {profile.label}
            </button>
          )}
          {items.map((item) => (
            <Link key={item.href} href={item.href} className={styles.menuItem} role="menuitem" onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <form action={signOutAction}>
            <button type="submit" className={styles.menuItemButton} role="menuitem">
              Log out
            </button>
          </form>
        </div>
      )}
      {profile && profileOpen &&
        createPortal(
          <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) setProfileOpen(false); }}>
            <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={profile.title}>
              <div className={styles.dialogHead}>
                <span className={styles.dialogTitle}>{profile.title}</span>
                <button ref={closeRef} type="button" className={styles.dialogClose} aria-label={profile.closeLabel} onClick={() => setProfileOpen(false)}>
                  ×
                </button>
              </div>
              <div className={styles.dialogBody}>{profile.content}</div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
