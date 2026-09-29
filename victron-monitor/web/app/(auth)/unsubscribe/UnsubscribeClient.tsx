'use client';

// The one button on `/unsubscribe` (PLAN_PHASE17.md §0.6 Q5, §8 Step 8) —
// deliberately a click, not an action that fires on page load. An email
// client (or a security scanner) prefetching the link itself must not be
// what actually unsubscribes someone; a GET request has no business
// mutating anything, and requiring an explicit click is what keeps this
// page from being that GET request in disguise.
import { startTransition, useState } from 'react';
import { Button } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import type { UnsubscribeResult } from './actions';
import styles from './unsubscribe.module.css';

export function UnsubscribeClient({ confirmAction, lang }: { confirmAction: () => Promise<UnsubscribeResult>; lang: Lang }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<UnsubscribeResult | null>(null);

  function handleClick() {
    setPending(true);
    startTransition(async () => {
      const r = await confirmAction();
      setPending(false);
      setResult(r);
    });
  }

  if (result?.ok) {
    // Also the correct message for a re-click of the same link — the
    // action is idempotent (`removeReportRecipient()`'s own "wasn't there"
    // early-return), so a second click looks and reads identically to the
    // first, never a confusing "already done" error.
    return <p className={styles.body}>{t(lang, 'unsubscribe_confirmed')}</p>;
  }
  if (result && !result.ok) {
    return <p className={styles.error}>{t(lang, 'unsubscribe_result_invalid')}</p>;
  }

  return (
    <Button type="button" onClick={handleClick} disabled={pending}>
      {pending ? t(lang, 'unsubscribe_removing') : t(lang, 'unsubscribe_button')}
    </Button>
  );
}
