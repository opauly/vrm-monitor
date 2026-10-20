'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Input, Panel, Select } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import type { SuggestedGroup } from '@/lib/propertyGroups';
import styles from './PropertiesManager.module.css';

// Sets up properties: create / rename / delete them, say which property each site is in, and let "Suggest groups" make a first
// guess. One block per customer (a customer's own page has one; the admin's page has one per customer with two or more sites).
// Every change calls a server action that re-checks who is asking and which customer owns what, then refreshes the page.

export type ManagerGroup = {
  customerId: string;
  /** Shown only when there is more than one group (the admin's view). */
  customerName: string | null;
  properties: { id: string; name: string }[];
  sites: { site_id: string; display_name: string; property_id: string | null }[];
};

export type ActionResult = { ok: boolean; error?: string };

export type PropertyActions = {
  create: (customerId: string, name: string) => Promise<ActionResult>;
  rename: (customerId: string, propertyId: string, name: string) => Promise<ActionResult>;
  remove: (customerId: string, propertyId: string) => Promise<ActionResult>;
  assign: (siteId: string, propertyId: string | null) => Promise<ActionResult>;
  suggest: (customerId: string) => Promise<SuggestedGroup[]>;
  apply: (customerId: string, groups: SuggestedGroup[]) => Promise<ActionResult & { created?: number }>;
};

function GroupBlock({ lang, group, actions, showName }: { lang: Lang; group: ManagerGroup; actions: PropertyActions; showName: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [suggestions, setSuggestions] = useState<(SuggestedGroup & { on: boolean })[] | null>(null);
  const siteName = (id: string) => group.sites.find((s) => s.site_id === id)?.display_name ?? id;

  const run = (job: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await job();
      if (!result.ok) setError(t(lang, 'properties_error'));
      else {
        after?.();
        router.refresh();
      }
    });
  };

  return (
    <div className={styles.group}>
      {showName && <h3 className={styles.customerName}>{group.customerName}</h3>}

      {group.properties.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'properties_none_yet')}</p>
      ) : (
        <ul className={styles.propertyList}>
          {group.properties.map((p) => (
            <PropertyRow key={p.id} lang={lang} property={p} count={group.sites.filter((s) => s.property_id === p.id).length} disabled={pending}
              onRename={(name) => run(() => actions.rename(group.customerId, p.id, name))}
              onDelete={() => { if (window.confirm(t(lang, 'properties_delete_confirm').replace('{name}', p.name))) run(() => actions.remove(group.customerId, p.id)); }} />
          ))}
        </ul>
      )}

      <form
        className={styles.addRow}
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) run(() => actions.create(group.customerId, newName), () => setNewName(''));
        }}
      >
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder={t(lang, 'properties_new_placeholder')} aria-label={t(lang, 'properties_new_placeholder')} disabled={pending} />
        <Button type="submit" disabled={pending || !newName.trim()}>{t(lang, 'properties_add')}</Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => setSuggestions((await actions.suggest(group.customerId)).map((g) => ({ ...g, on: true }))));
          }}
        >
          {t(lang, 'properties_suggest')}
        </Button>
      </form>

      {suggestions !== null &&
        (suggestions.length === 0 ? (
          <p className={styles.empty}>{t(lang, 'properties_suggest_none')}</p>
        ) : (
          <div className={styles.suggestions}>
            <p className={styles.hint}>{t(lang, 'properties_suggest_intro')}</p>
            {suggestions.map((g, i) => (
              <label key={g.name} className={styles.suggestion}>
                <input type="checkbox" checked={g.on} onChange={(e) => setSuggestions(suggestions.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <span>
                  <strong>{g.name}</strong>
                  <span className={styles.members}>{g.site_ids.map(siteName).join(' · ')}</span>
                </span>
              </label>
            ))}
            <div className={styles.suggestActions}>
              <Button
                type="button"
                disabled={pending || !suggestions.some((g) => g.on)}
                onClick={() => run(() => actions.apply(group.customerId, suggestions.filter((g) => g.on).map(({ name, site_ids }) => ({ name, site_ids }))), () => setSuggestions(null))}
              >
                {t(lang, 'properties_suggest_apply')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSuggestions(null)}>{t(lang, 'properties_suggest_dismiss')}</Button>
            </div>
          </div>
        ))}

      {group.properties.length > 0 && (
        <table className={styles.siteTable}>
          <thead>
            <tr>
              <th>{t(lang, 'properties_col_site')}</th>
              <th>{t(lang, 'properties_col_property')}</th>
            </tr>
          </thead>
          <tbody>
            {group.sites.map((s) => (
              <tr key={s.site_id}>
                <td>{s.display_name}</td>
                <td>
                  <Select
                    value={s.property_id ?? ''}
                    disabled={pending}
                    aria-label={`${t(lang, 'properties_col_property')} — ${s.display_name}`}
                    onChange={(e) => run(() => actions.assign(s.site_id, e.target.value || null))}
                  >
                    <option value="">{t(lang, 'properties_none_option')}</option>
                    {group.properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

function PropertyRow({ lang, property, count, disabled, onRename, onDelete }: { lang: Lang; property: { id: string; name: string }; count: number; disabled: boolean; onRename: (name: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(property.name);
  return (
    <li className={styles.propertyRow}>
      {editing ? (
        <form
          className={styles.renameForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== property.name) onRename(name);
            setEditing(false);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={t(lang, 'properties_rename')} autoFocus />
          <Button type="submit" disabled={disabled}>{t(lang, 'properties_save')}</Button>
          <Button type="button" variant="ghost" onClick={() => { setName(property.name); setEditing(false); }}>{t(lang, 'properties_cancel')}</Button>
        </form>
      ) : (
        <>
          <span className={styles.propertyName}>{property.name}</span>
          <span className={styles.count}>{t(lang, count === 1 ? 'properties_sites_one' : 'properties_sites_many').replace('{n}', String(count))}</span>
          <span className={styles.rowActions}>
            <Button type="button" variant="ghost" onClick={() => setEditing(true)} disabled={disabled}>{t(lang, 'properties_rename')}</Button>
            <Button type="button" variant="ghost" onClick={onDelete} disabled={disabled}>{t(lang, 'properties_delete')}</Button>
          </span>
        </>
      )}
    </li>
  );
}

export function PropertiesManager({ lang, groups, actions }: { lang: Lang; groups: ManagerGroup[]; actions: PropertyActions }) {
  if (groups.length === 0) return null;
  return (
    <Panel className={styles.panel}>
      <h2 className={styles.title}>{t(lang, 'properties_title')}</h2>
      <p className={styles.intro}>{t(lang, 'properties_intro')}</p>
      {groups.map((g) =>
        // Several customers at once: each is a collapsed block (name, how many properties and sites) so it is not a wall of sites;
        // with one customer showing, it is simply open.
        groups.length > 1 ? (
          <details key={g.customerId} className={styles.collapsible}>
            <summary className={styles.collapsibleSummary}>
              <span className={styles.customerName}>{g.customerName}</span>
              <span className={styles.count}>
                {t(lang, 'properties_summary').replace('{p}', String(g.properties.length)).replace('{s}', String(g.sites.length))}
              </span>
            </summary>
            <GroupBlock lang={lang} group={g} actions={actions} showName={false} />
          </details>
        ) : (
          <GroupBlock key={g.customerId} lang={lang} group={g} actions={actions} showName={g.customerName !== null} />
        ),
      )}
    </Panel>
  );
}
