// "Suggest groups": a first guess at which of a customer's sites belong together, so setting up properties is one click
// instead of one site at a time. Sites within about a kilometre of each other are one place (rounded coordinates, the same idea
// the storm warnings use to say "El Encino" once instead of four times); a site with no coordinates joins a place whose sites'
// names it shares a start with. A group needs two or more sites, and a site that already has a property is never touched.
// The name is the words the sites' names have in common ("Vista Atenas LP M1 (Houses)" + "...M2 (Studios)" -> "Vista Atenas LP").

export type GroupableSite = { site_id: string; display_name: string; latitude: number | null; longitude: number | null; property_id?: string | null };
export type SuggestedGroup = { name: string; site_ids: string[] };

const baseName = (name: string) => name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

/** The leading words every name shares, without a trailing token that is just a number/code ("M1", "2"). */
export function commonName(names: string[]): string {
  const split = names.map((n) => baseName(n).split(' '));
  const first = split[0] ?? [];
  let n = 0;
  while (n < first.length && split.every((words) => words[n]?.toLowerCase() === first[n].toLowerCase())) n += 1;
  let words = first.slice(0, n);
  // "Vista Atenas LP M" -> a trailing "M1"/"M2" differing only by a code is already excluded above; drop a dangling code-like word.
  while (words.length > 1 && /^[A-Za-z]?\d+$/.test(words[words.length - 1])) words = words.slice(0, -1);
  return words.length > 0 ? words.join(' ') : baseName(names[0] ?? '');
}

export function suggestGroups(sites: GroupableSite[]): SuggestedGroup[] {
  const free = sites.filter((s) => !s.property_id);
  const places = new Map<string, GroupableSite[]>();
  const unplaced: GroupableSite[] = [];
  for (const s of free) {
    if (s.latitude === null || s.longitude === null) unplaced.push(s);
    else {
      const key = `${s.latitude.toFixed(2)},${s.longitude.toFixed(2)}`;
      places.set(key, [...(places.get(key) ?? []), s]);
    }
  }
  const groups: GroupableSite[][] = [...places.values()];
  // A site without coordinates joins a place when its name starts the way that place's name does.
  const leftover: GroupableSite[] = [];
  for (const s of unplaced) {
    const key = baseName(s.display_name).split(' ').slice(0, 2).join(' ').toLowerCase();
    const home = groups.find((g) => g.some((m) => baseName(m.display_name).toLowerCase().startsWith(key)) && key.length > 3);
    if (home) home.push(s);
    else leftover.push(s);
  }
  // Sites with no coordinates anywhere: group by the first two words of their names.
  const byName = new Map<string, GroupableSite[]>();
  for (const s of leftover) {
    const key = baseName(s.display_name).split(' ').slice(0, 2).join(' ').toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), s]);
  }
  groups.push(...byName.values());

  return groups
    .filter((g) => g.length >= 2)
    .map((g) => ({ name: commonName(g.map((s) => s.display_name)), site_ids: g.map((s) => s.site_id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
