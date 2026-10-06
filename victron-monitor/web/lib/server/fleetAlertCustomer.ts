import 'server-only';

// Which customer account holds the admin's own fleet. The alert engine already
// knows it as `ALERTS_FORCE_CUSTOMER_IDS` (the internal "Pauly & Co Portfolio"
// account: no login, trial plan, but exactly the sites to watch), so the web
// reads the same variable — set it on the web host too — rather than guessing
// by name. The first id is the one the admin page manages.
export function fleetAlertCustomerId(): string | null {
  const ids = (process.env.ALERTS_FORCE_CUSTOMER_IDS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return ids[0] ?? null;
}
