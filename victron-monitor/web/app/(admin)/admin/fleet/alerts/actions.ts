'use server';

import 'server-only';

// Saves the alert preferences of the admin's own fleet account — the same
// settings customers get on /app/alerts. The account comes from server config
// (`ALERTS_FORCE_CUSTOMER_IDS`), never from the form, and `requireAdmin()`
// comes first.
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/server/auth';
import { fleetAlertCustomerId } from '@/lib/server/fleetAlertCustomer';
import { ALERT_KINDS, saveAlertPreferences, type AlertKind, type AlertPreference } from '@/lib/server/db';
import { t } from '@/lib/i18n/strings';
import type { AlertSettingsState } from '@/app/(portal)/app/alerts/actions';

export async function saveFleetAlertSettingsAction(_prev: AlertSettingsState, formData: FormData): Promise<AlertSettingsState> {
  const admin = await requireAdmin();
  const customerId = fleetAlertCustomerId();
  if (!customerId) return { error: t(admin.uiLanguage, 'alerts_save_error') };

  const prefs = Object.fromEntries(
    ALERT_KINDS.map((kind) => [
      kind,
      { enabled: formData.get(`enabled_${kind}`) === 'on', email: formData.get(`email_${kind}`) === 'on', push: formData.get(`push_${kind}`) === 'on' },
    ]),
  ) as Record<AlertKind, AlertPreference>;

  try {
    await saveAlertPreferences(customerId, prefs);
  } catch {
    return { error: t(admin.uiLanguage, 'alerts_save_error') };
  }

  revalidatePath('/admin/fleet/alerts');
  return { success: true };
}
