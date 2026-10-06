'use client';

import { useEffect, useState } from 'react';
import { Button, Panel } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import { urlBase64ToUint8Array, type PushActionResult, type PushSubscriptionInput, type PushTestResult } from '@/lib/push';
import { browserPushEnv, detectPushStatus, type PushStatus } from '@/lib/pushClient';
import styles from './PushPanel.module.css';

// "Phone notifications" — registers THIS browser/phone for push alerts.
//
// The browser side of web push, end to end:
//   1. register /sw.js (the service worker that will receive the pushes);
//   2. on a tap, ask permission (browsers refuse to prompt without a gesture);
//   3. `pushManager.subscribe()` with the server's public VAPID key — the push
//      service hands back this device's private endpoint + encryption keys;
//   4. send that subscription to the server (the `onSubscribe` action) to store.
//
// The same panel serves the customer page and the admin fleet page: they pass
// their own server actions, so who a device belongs to is decided on the
// server from the session, never here.
//
// iPhone is the awkward case: Safari only exposes push to a site that has been
// added to the Home Screen (iOS 16.4+), and an installed app has its own
// cookie jar, so the person has to sign in again inside it. Hence the steps.

type Props = {
  lang: Lang;
  /** Base64url VAPID public key, or null if the server has none configured. */
  vapidPublicKey: string | null;
  intro?: string;
  onSubscribe: (subscription: PushSubscriptionInput) => Promise<PushActionResult>;
  onUnsubscribe: (endpoint: string) => Promise<PushActionResult>;
  onTest: () => Promise<PushTestResult>;
};

export function PushPanel({ lang, vapidPublicKey, intro, onSubscribe, onUnsubscribe, onTest }: Props) {
  const [status, setStatus] = useState<PushStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectPushStatus(vapidPublicKey, browserPushEnv()).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    if (!vapidPublicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
      const json = subscription.toJSON();
      const result = await onSubscribe({ endpoint: json.endpoint ?? subscription.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } });
      if (result.error) {
        await subscription.unsubscribe();
        setMessage({ text: result.error, tone: 'error' });
        setStatus('off');
      } else {
        setStatus('on');
      }
    } catch {
      setMessage({ text: t(lang, 'push_error_generic'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await onUnsubscribe(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus('off');
    } catch {
      setMessage({ text: t(lang, 'push_error_generic'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await onTest();
      if (result.error) setMessage({ text: result.error, tone: 'error' });
      else if (!result.devices) setMessage({ text: t(lang, 'push_test_none'), tone: 'error' });
      else if (!result.delivered) setMessage({ text: t(lang, 'push_test_failed'), tone: 'error' });
      else setMessage({ text: t(lang, 'push_test_sent'), tone: 'ok' });
    } catch {
      setMessage({ text: t(lang, 'push_error_generic'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className={styles.label}>{t(lang, 'push_title')}</h2>
      <Panel>
        <p className={styles.intro}>{intro ?? t(lang, 'push_intro')}</p>

        {status === 'loading' && <p className={styles.status}>{t(lang, 'push_status_loading')}</p>}
        {status === 'not_configured' && <p className={styles.status}>{t(lang, 'push_not_configured')}</p>}
        {status === 'unsupported' && <p className={styles.status}>{t(lang, 'push_unsupported')}</p>}
        {status === 'blocked' && <p className={styles.warn}>{t(lang, 'push_blocked')}</p>}

        {status === 'needs_install' && (
          <div className={styles.install}>
            <p className={styles.installTitle}>{t(lang, 'push_install_title')}</p>
            <ol className={styles.steps}>
              <li>{t(lang, 'push_install_step1')}</li>
              <li>{t(lang, 'push_install_step2')}</li>
              <li>{t(lang, 'push_install_step3')}</li>
              <li>{t(lang, 'push_install_step4')}</li>
            </ol>
          </div>
        )}

        {(status === 'off' || status === 'on') && (
          <>
            <p className={status === 'on' ? styles.on : styles.status}>{t(lang, status === 'on' ? 'push_status_on' : 'push_status_off')}</p>
            <div className={styles.actions}>
              {status === 'off' ? (
                <Button type="button" onClick={enable} disabled={busy}>
                  {t(lang, 'push_btn_enable')}
                </Button>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={sendTest} disabled={busy}>
                    {t(lang, 'push_btn_test')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={disable} disabled={busy}>
                    {t(lang, 'push_btn_disable')}
                  </Button>
                </>
              )}
            </div>
          </>
        )}

        {message && (
          <p className={message.tone === 'ok' ? styles.on : styles.warn} role="status">
            {message.text}
          </p>
        )}
      </Panel>
    </div>
  );
}
