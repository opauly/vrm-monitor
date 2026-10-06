'use server';

import 'server-only';

// Server Action for `/app/alerts` — saves the customer's own alert
// preferences. `customerId` always comes from the session, never the form.
// Re-checks the same tier gate the page uses: a customer without live
// monitoring has no alerts to configure, and the page hiding the form is UX,
// not the control.
import { revalidatePath } from 'next/cache';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { ALERT_KINDS, getCustomer, getDashboardAccess, saveAlertPreferences, type AlertKind, type AlertPreference } from '@/lib/server/db';
import { t } from '@/lib/i18n/strings';

export type AlertSettingsState = { error?: string; success?: boolean };

export async function saveAlertSettingsAction(_prev: AlertSettingsState, formData: FormData): Promise<AlertSettingsState> {
  const session = await requireCustomerAllowPending();
  const lang = session.uiLanguage;

  const customer = await getCustomer(session.customerId);
  if (session.provisioningState !== 'active' || !(await getDashboardAccess(customer))) {
    return { error: t(lang, 'alerts_save_error') };
  }

  // A checkbox that is off is simply absent from FormData, so "present and
  // 'on'" is the whole parse — there is nothing else a client could send that
  // means anything.
  const prefs = Object.fromEntries(
    ALERT_KINDS.map((kind) => [
      kind,
      { enabled: formData.get(`enabled_${kind}`) === 'on', email: formData.get(`email_${kind}`) === 'on', push: formData.get(`push_${kind}`) === 'on' },
    ]),
  ) as Record<AlertKind, AlertPreference>;

  try {
    await saveAlertPreferences(session.customerId, prefs);
  } catch {
    return { error: t(lang, 'alerts_save_error') };
  }

  revalidatePath('/app/alerts');
  return { success: true };
}
