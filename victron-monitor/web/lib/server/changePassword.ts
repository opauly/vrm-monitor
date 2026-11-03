import 'server-only';

// The change-password flow shared by the customer's Profile and the admin's: re-authenticate with the CURRENT password
// before `updateUser`, so a stolen live session alone cannot change it. Lives here, not in a `'use server'` file, because
// everything exported from one of those is callable from the browser, and this takes the email to re-authenticate as.
import { createSupabaseServerClient } from '@/lib/server/supabase';
import { t, type Lang } from '@/lib/i18n/strings';

export type PasswordFormState = { error?: string; success?: boolean };

export async function changePasswordFor(email: string, lang: Lang, formData: FormData): Promise<PasswordFormState> {
  const current = String(formData.get('current_password') ?? '');
  const next = String(formData.get('new_password') ?? '');
  const confirm = String(formData.get('confirm_password') ?? '');

  if (!current || !next || !confirm) return { error: t(lang, 'profile_change_password_error_generic') };
  if (next.length < 8) return { error: t(lang, 'profile_change_password_error_short') };
  if (next !== confirm) return { error: t(lang, 'profile_change_password_error_mismatch') };

  const supabase = await createSupabaseServerClient();
  // Never call `updateUser({ password })` without a `signInWithPassword` using the caller-supplied current password first.
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: current });
  if (reauthError) return { error: t(lang, 'profile_change_password_error_wrong_current') };

  const { error: updateError } = await supabase.auth.updateUser({ password: next });
  if (updateError) return { error: t(lang, 'profile_change_password_error_generic') };
  return { success: true };
}
