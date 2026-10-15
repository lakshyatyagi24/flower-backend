/**
 * Settings keys that look like credentials. Secrets live in environment variables, never in the Setting
 * table. This denylist is defence in depth on top of the public allowlist (SettingsService.PUBLIC_PREFIXES):
 * such rows are never returned by ANY settings read (public or admin) and can never be written through the API.
 */
const SECRET_KEY_SUFFIX = /(secret|key|token|password|passwd|pwd|pass)$/i;
// Anywhere in the key: credential(s), private (privateKey, privateToken ...).
const SECRET_KEY_ANYWHERE = /(credential|private)/i;

export function isSecretSettingKey(key: string): boolean {
  const k = String(key ?? '').trim();
  // Whole `payment.` namespace is reserved for provider credentials (keys live in env since Task 5.7).
  if (/^payment[._:\-\s]/i.test(k) || k.toLowerCase() === 'payment') return true;
  return SECRET_KEY_SUFFIX.test(k) || SECRET_KEY_ANYWHERE.test(k);
}
