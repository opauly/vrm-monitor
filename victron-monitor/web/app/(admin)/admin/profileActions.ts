'use server';

import 'server-only';

// The admin's change-password action, for the Profile window in the account menu. Same flow as a customer's.
import { requireAdmin } from '@/lib/server/auth';
import { changePasswordFor, type PasswordFormState } from '@/lib/server/changePassword';

export async function changeAdminPasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const session = await requireAdmin();
  return changePasswordFor(session.email, session.uiLanguage, formData);
}
