'use server';

import 'server-only';

// Server Actions for `app/(portal)/app/profile` (PLAN_PHASE14.md §2 Step 4).
// `requireCustomerAllowPending()` first in both, per §3 — a
// `pending_subscription` customer must still be able to edit their
// profile and change their password (PLAN_PHASE16.md §6.4).
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { changePasswordFor } from '@/lib/server/changePassword';
import { updateCustomerProfile, type ProfileUpdateFields } from '@/lib/server/db';
import { t } from '@/lib/i18n/strings';

const stringOrNull = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null), z.string().nullable());

const profileFormSchema = z.object({
  name: z.string().trim().min(1),
  contact_name: stringOrNull,
  contact_email: stringOrNull,
  country: z.string().trim().min(1),
  ui_language: z.enum(['en', 'es']),
});

export type ProfileFormState = { error?: string; success?: boolean };

export async function updateProfileAction(_prevState: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const session = await requireCustomerAllowPending();

  const parsed = profileFormSchema.safeParse({
    name: formData.get('name'),
    contact_name: formData.get('contact_name'),
    contact_email: formData.get('contact_email'),
    country: formData.get('country'),
    ui_language: formData.get('ui_language'),
  });
  if (!parsed.success) {
    return { error: t(session.uiLanguage, 'profile_save_error') };
  }

  try {
    await updateCustomerProfile(session.customerId, parsed.data as ProfileUpdateFields);
  } catch {
    return { error: t(session.uiLanguage, 'profile_save_error') };
  }

  // `updateCustomerProfile` can change `ui_language`, which
  // `app/(portal)/app/layout.tsx` reads on every render to build the nav —
  // revalidating the `/app` *layout* (not just this page) is what makes a
  // language switch visible in the nav without a manual refresh, since this
  // action itself doesn't touch a cookie (the thing that would otherwise
  // trigger an automatic re-render per the Server Actions guide).
  revalidatePath('/app', 'layout');
  return { success: true };
}

export type PasswordFormState = { error?: string; success?: boolean };

export async function changePasswordAction(_prevState: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const session = await requireCustomerAllowPending();
  return changePasswordFor(session.email, session.uiLanguage, formData);
}
