// Read only recovery state, never retain or log credentials from an email URL.
export function recoveryLinkState(search = '', hash = '') {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const failed = query.get('link_error') === '1' || fragment.has('error') || query.has('error');
  return {
    requested: query.get('recovery') === '1' || fragment.get('type') === 'recovery' || failed,
    failed,
  };
}
export const recoveryLinkMessage = 'This password-reset link is invalid, expired, or has already been used. Request a new email and open only the newest link.';
