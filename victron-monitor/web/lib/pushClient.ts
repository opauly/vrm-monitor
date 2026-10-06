// Browser-side detection for the "Phone notifications" panel, kept out of the
// component so every device case can be tested with a simulated browser
// (`PushEnv`) instead of needing a real iPhone to find a bug.

export type PushStatus = 'loading' | 'unsupported' | 'not_configured' | 'needs_install' | 'blocked' | 'off' | 'on';

export type PushEnv = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Running as an installed Home Screen app (not a browser tab). */
  installed: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | null;
  /** Registers the service worker and reports whether this device already has a push subscription. */
  register: () => Promise<{ subscribed: boolean }>;
};

export function browserPushEnv(): PushEnv {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    installed: window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : null,
    register: async () => {
      const registration = await navigator.serviceWorker.register('/sw.js');
      return { subscribed: Boolean(await registration.pushManager.getSubscription()) };
    },
  };
}

// iPadOS 13+ reports itself as a Mac; a touch screen is what gives it away.
function isIos(env: PushEnv): boolean {
  return /iPad|iPhone|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
}

export async function detectPushStatus(vapidPublicKey: string | null, env: PushEnv): Promise<PushStatus> {
  if (!vapidPublicKey) return 'not_configured';
  // Safari only exposes push to a site added to the Home Screen (iOS 16.4+) — a
  // plain Safari tab has no PushManager at all, so "install first" is the only
  // honest answer there rather than "unsupported".
  if (isIos(env) && !env.installed) return 'needs_install';
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  if (env.permission === 'denied') return 'blocked';
  try {
    const { subscribed } = await env.register();
    return subscribed && env.permission === 'granted' ? 'on' : 'off';
  } catch {
    return 'unsupported';
  }
}
