'use client';

// The one client boundary in AppShell's otherwise all-Server-Component nav
// (see AppShell.tsx's own comment on why it stays a Server Component) —
// `usePathname()` is the only way to know which tab is current, so it's
// isolated to this leaf rather than converting the whole shell to a client
// component. Matches `href` as a prefix, not just exact equality, so a
// sub-route (e.g. `/admin/fleet/[site_id]`) still highlights its parent
// tab (`/admin/fleet`). `exact` turns that off for a home route (`/app` is a prefix of every page), and `match` lists other
// routes that belong to the same tab (Reports also covers its Import CSV and Branding tabs).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function NavLink({ href, className, activeClassName, exact, match, children }: {
  href: string; className: string; activeClassName: string; exact?: boolean; match?: string[]; children: ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (exact ? pathname === href : under(pathname, href)) || !!match?.some((m) => under(pathname, m));
  return (
    <Link href={href} className={isActive ? `${className} ${activeClassName}` : className}>
      {children}
    </Link>
  );
}
