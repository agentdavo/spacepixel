import type { Campaign, CampaignMission, Placement } from './types.ts';

export interface ContentDiagnostic {
  severity: 'error';
  code: string;
  missionId: string;
  path: string;
  message: string;
}

/** Inject catalogs; authoring validation must not load meshes, a DOM or the renderer. */
export interface MissionCatalogs {
  blueprints?: ReadonlySet<string>;
  speakers?: ReadonlySet<string>;
  codex?: ReadonlySet<string>;
  /** Tags supplied by a host rather than declared by this mission. */
  externalTags?: readonly string[];
}

/**
 * Static authoring checks only. Predicates are never executed or parsed, and
 * flags can be supplied by the host/set pieces. Passing does not prove that
 * a mission is completable. Deferred declarations are valid references.
 */
export function validateMission(mission: CampaignMission, catalogs: MissionCatalogs = {}): ContentDiagnostic[] {
  const issues: ContentDiagnostic[] = [];
  const error = (code: string, path: string, message: string) => {
    issues.push({ severity: 'error', code, missionId: mission.id, path, message });
  };
  const id = (value: string, path: string) => {
    if (!value.trim()) error('empty-id', path, 'An ID must contain non-whitespace text.');
  };
  const unique = (values: readonly string[], path: string) => {
    const seen = new Set<string>();
    values.forEach((value, i) => {
      id(value, `${path}[${i}].id`);
      if (seen.has(value)) error('duplicate-id', `${path}[${i}].id`, `Duplicate ID: ${value}`);
      seen.add(value);
    });
  };
  const number = (value: number, path: string, minimum = 0, integer = false) => {
    if (!Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
      error('invalid-number', path, `Expected a finite ${integer ? 'integer ' : ''}number >= ${minimum}.`);
    }
  };
  const vector = (value: readonly number[], path: string) => {
    if (value.length !== 3 || !value.every(Number.isFinite)) error('invalid-vector', path, 'Expected three finite coordinates.');
  };
  const matches = (tag: string, query: string) => tag === query || tag.startsWith(`${query}-`);
  // Mirror CampaignRunner.tagFor/matches without allocating count entries.
  const hasTag = (query: string): boolean => {
    if (!query.trim()) return false;
    if (mission.setpieces.some(p => matches(p.tag, query)) || catalogs.externalTags?.some(t => matches(t, query))) return true;
    return mission.spawns.some(s => {
      if (!Number.isInteger(s.count) || s.count < 1) return false;
      const base = s.tag || s.blueprint;
      if (matches(base, query)) return true;
      if (s.tag && s.count === 1) return false;
      if (!query.startsWith(`${base}-`)) return false;
      const suffix = query.slice(base.length + 1);
      const member = Number(suffix);
      return String(member) === suffix && Number.isInteger(member) && member >= 1 && member <= s.count;
    });
  };
  const tag = (value: string, path: string) => {
    if (!hasTag(value)) error('unknown-tag', path, `No declared ship, set piece or host tag matches: ${value}`);
  };
  const place = (p: Placement, path: string) => {
    vector(p.offset, `${path}.offset`);
    if (p.at === 'point') vector(p.point, `${path}.point`);
    if (p.at === 'tag') tag(p.tag, `${path}.tag`);
    if (p.at === 'gate' && p.gateIndex !== undefined) number(p.gateIndex, `${path}.gateIndex`, 0, true);
  };
  id(mission.id, 'id');
  unique(mission.objectives.map(o => o.id), 'objectives');
  unique(mission.chatter.map(b => b.id), 'chatter');
  const objectives = new Set(mission.objectives.map(o => o.id));
  const pieceTags = new Set(mission.setpieces.map(p => p.tag));
  mission.objectives.forEach((o, i) => {
    if (o.navTag !== undefined && !pieceTags.has(o.navTag)) {
      error('unknown-nav-tag', `objectives[${i}].navTag`, `Navigation requires an exact set-piece tag: ${o.navTag}`);
    }
    const nav = o.navigation;
    if (!nav) return;
    const path = `objectives[${i}].navigation`;
    if (o.navTag !== undefined) error('conflicting-navigation', path, 'Use navigation or navTag, not both.');
    if (nav.label !== undefined) id(nav.label, `${path}.label`);
    // Navigation resolves only runner-owned targets, not generic host tags.
    const exists = nav.kind === 'setpiece' ? pieceTags.has(nav.tag) : mission.spawns.some(s => {
      if (!Number.isInteger(s.count) || s.count < 1) return false;
      const base = s.tag || s.blueprint;
      if (nav.kind === 'group') return nav.tag === base;
      if (nav.kind !== 'ship') return false;
      if (s.tag && s.count === 1) return nav.tag === s.tag;
      if (!nav.tag.startsWith(`${base}-`)) return false;
      const suffix = nav.tag.slice(base.length + 1);
      const member = Number(suffix);
      return String(member) === suffix && Number.isInteger(member) && member >= 1 && member <= s.count;
    });
    if (!exists) error('unknown-navigation-target', `${path}.tag`, `No declared ${nav.kind} navigation target: ${nav.tag}`);
  });
  mission.spawns.forEach((s, i) => {
    const path = `spawns[${i}]`;
    if (catalogs.blueprints && !catalogs.blueprints.has(s.blueprint)) error('unknown-blueprint', `${path}.blueprint`, `Unknown blueprint: ${s.blueprint}`);
    number(s.count, `${path}.count`, 1, true);
    if (s.delay !== undefined) number(s.delay, `${path}.delay`);
    place(s.place, `${path}.place`);
    if (s.routeTo !== undefined) tag(s.routeTo, `${path}.routeTo`);
  });
  mission.setpieces.forEach((p, i) => {
    const path = `setpieces[${i}]`;
    id(p.tag, `${path}.tag`);
    if (mission.setpieces.findIndex(other => other.tag === p.tag) !== i) error('duplicate-tag', `${path}.tag`, `Duplicate set-piece tag: ${p.tag}`);
    place(p.place, `${path}.place`);
    for (const key of ['radius', ...(p.kind === 'beacon' ? ['hold'] : [])]) {
      const value = p.params?.[key];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
        error('invalid-number', `${path}.params.${key}`, 'Expected a positive finite number.');
      }
    }
  });
  mission.chatter.forEach((beat, i) => {
    const path = `chatter[${i}]`;
    const t = beat.trigger;
    if ((t.on === 'objective-active' || t.on === 'objective-done') && !objectives.has(t.objective)) {
      error('unknown-objective', `${path}.trigger.objective`, `Unknown objective: ${t.objective}`);
    }
    if (t.on === 'near') { tag(t.tag, `${path}.trigger.tag`); number(t.distance, `${path}.trigger.distance`); }
    if (t.on === 'time') number(t.at, `${path}.trigger.at`);
    if (t.on === 'kills') number(t.count, `${path}.trigger.count`, 1, true);
    beat.lines.forEach((line, j) => {
      if (catalogs.speakers && line.who !== 'system' && !catalogs.speakers.has(line.who)) {
        error('unknown-speaker', `${path}.lines[${j}].who`, `Unknown speaker: ${line.who}`);
      }
      if (line.delay !== undefined) number(line.delay, `${path}.lines[${j}].delay`);
    });
  });
  for (const field of ['codex', 'codexOnStart'] as const) {
    mission[field]?.forEach((entry, i) => {
      if (catalogs.codex && !catalogs.codex.has(entry)) error('unknown-codex', `${field}[${i}]`, `Unknown codex entry: ${entry}`);
    });
  }
  if (mission.modifiers?.timeLimit !== undefined) number(mission.modifiers.timeLimit, 'modifiers.timeLimit');
  return issues;
}

/** Story order is a save contract. Generated operations use validateMission directly. */
export function validateCampaign(campaign: Campaign, catalogs: MissionCatalogs = {}): ContentDiagnostic[] {
  const issues: ContentDiagnostic[] = [];
  const seen = new Set<string>();
  const lookups = { ...catalogs, speakers: catalogs.speakers ?? new Set(campaign.cast.map(c => c.id)), codex: catalogs.codex ?? new Set(campaign.codex.map(c => c.id)) };
  campaign.missions.forEach((mission, i) => {
    if (seen.has(mission.id)) issues.push({ severity: 'error', code: 'duplicate-mission', missionId: mission.id, path: `missions[${i}].id`, message: `Duplicate mission ID: ${mission.id}` });
    seen.add(mission.id);
    if (mission.episode !== i + 1) issues.push({ severity: 'error', code: 'episode-order', missionId: mission.id, path: `missions[${i}].episode`, message: `Expected episode ${i + 1}; story saves currently use this order.` });
    issues.push(...validateMission(mission, lookups));
  });
  return issues;
}
