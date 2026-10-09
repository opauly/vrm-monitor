'use client';

import { useEffect } from 'react';

// Finishes what a tapped push notification started. The service worker
// (public/sw.js) leaves the notification's target in a small cache entry because
// an installed iPhone app can open at its start page and ignore the URL it was
// given — which for an admin lands on the Customers tab, not the site that raised
// the alert. This reads that entry when the app loads or comes back to the front
// and navigates there. It does nothing unless a tap left something fresh behind.

const CACHE = 'vrm-pending-nav';
const KEY = '/__pending-nav';
const MAX_AGE_MS = 2 * 60 * 1000;

async function takePending(): Promise<string | null> {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE);
    const stored = await cache.match(KEY);
    if (!stored) return null;
    await cache.delete(KEY); // one tap, one navigation
    const { url, at } = (await stored.json()) as { url?: unknown; at?: unknown };
    if (typeof url !== 'string' || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return null;
    const target = new URL(url, window.location.origin);
    return target.origin === window.location.origin ? `${target.pathname}${target.search}${target.hash}` : null;
  } catch {
    return null;
  }
}

export function PendingNotificationNav() {
  useEffect(() => {
    let active = true;
    const go = async () => {
      const target = await takePending();
      const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (active && target && target !== here) window.location.assign(target);
    };
    void go();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void go();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);
  return null;
}
