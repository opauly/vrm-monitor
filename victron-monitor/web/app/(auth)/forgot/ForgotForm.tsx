'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Field, Input } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import { requestPasswordResetAction, type ForgotFormState } from './actions';
import styles from './forgot.module.css';

const INITIAL_STATE: ForgotFormState = {};

// Deliberately has no error state at all — see actions.ts's own comment.
// `state.submitted` is the only outcome this form can ever show, whatever
// the server actually did.
export function ForgotForm({ lang }: { lang: Lang }) {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL_STATE);

  if (state.submitted) {
    return (
      <div>
        <p className={styles.confirmation}>{t(lang, 'forgot_confirmation')}</p>
        <Link href="/login" className={styles.backLink}>
          {t(lang, 'forgot_back_to_login')}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className={styles.form} noValidate>
      <Field label={t(lang, 'forgot_email')} htmlFor="forgot-email" required>
        <Input id="forgot-email" name="email" type="email" autoComplete="email" required disabled={pending} />
      </Field>
      <Button type="submit" disabled={pending} className={styles.submit}>
        {pending ? t(lang, 'forgot_sending') : t(lang, 'forgot_submit')}
      </Button>
      <Link href="/login" className={styles.backLink}>
        {t(lang, 'forgot_back_to_login')}
      </Link>
    </form>
  );
}
