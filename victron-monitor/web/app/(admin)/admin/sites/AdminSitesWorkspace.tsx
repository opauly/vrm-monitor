'use client';

import { useState } from 'react';
import { PropertiesManager, type ManagerGroup, type PropertyActions } from '@/components/app';
import type { SiteRecord } from '@/lib/server/db';
import type { AdminCustomerRow } from '@/lib/server/db/admin';
import type { Lang } from '@/lib/i18n/strings';
import { AdminSitesManager } from './AdminSitesManager';

// The sites table and the Properties panel under it share ONE customer filter: pick a customer at the top and both narrow to it
// (with "all" the Properties panel lists each customer as a collapsed block, so it is not a wall of sites).
export function AdminSitesWorkspace({ sites, customers, groups, actions, lang }: { sites: SiteRecord[]; customers: AdminCustomerRow[]; groups: ManagerGroup[]; actions: PropertyActions; lang: Lang }) {
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  return (
    <>
      <AdminSitesManager sites={sites} customers={customers} lang={lang} customerFilter={customerFilter} onCustomerFilterChange={setCustomerFilter} />
      <PropertiesManager lang={lang} groups={customerFilter === 'all' ? groups : groups.filter((g) => g.customerId === customerFilter)} actions={actions} />
    </>
  );
}
