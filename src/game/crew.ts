/**
 * Hires — people who sign on with airframe 0413 from a conversation
 * (dialog effect `{ recruit: id }` → dialogHooks.onRecruit). Kept minimal:
 *
 *   brennick-mechanic   "Two-Coats" Brennick keeps the Kestrel together with
 *                       spit and litany: hull repairs at any station cost
 *                       REPAIR_DISCOUNT less (his labour, the yard's plate).
 *   magpie-due          Magpie flies the Magpie's Due with the wing in free
 *                       flight (a Rustwake Gaff: harpoon and a fast exit).
 *
 * Pure data + functions; storage under its own key (like the ledger and the
 * contract book) so episode saves never roll it back.
 */
export type HireId = 'brennick-mechanic' | 'magpie-due';

export interface HireSpec {
  id: HireId;
  name: string;
  role: string;
  /** One line for the dock log when they sign on. */
  signs: string;
}

export const HIRES: Record<HireId, HireSpec> = {
  'brennick-mechanic': { id: 'brennick-mechanic', name: '"Two-Coats" Brennick', role: 'Mechanic', signs: 'TWO-COATS BRENNICK SIGNS ON AS MECHANIC · HULL REPAIRS 30% CHEAPER' },
  'magpie-due': { id: 'magpie-due', name: 'Magpie', role: 'Wingman (Magpie’s Due)', signs: 'MAGPIE AND THE DUE JOIN THE WING IN FREE FLIGHT' },
};

/** Hull repair price multiplier with a mechanic aboard. */
export const REPAIR_DISCOUNT = 0.3;

/** The wingman Magpie flies. */
export const MAGPIE_WING = { blueprint: 'rw-gaff', name: 'Magpie’s Due', faction: 'rustwake' as const };

export interface Crew {
  hired: HireId[];
}

export function newCrew(): Crew {
  return { hired: [] };
}

export function isHire(id: string): id is HireId {
  return id in HIRES;
}

export function normaliseCrew(raw: unknown): Crew {
  const r = raw as Partial<Crew> | null;
  const hired = Array.isArray(r?.hired) ? r!.hired.filter((x): x is HireId => typeof x === 'string' && isHire(x)) : [];
  return { hired: [...new Set(hired)] };
}

/** Sign someone on. Returns the new crew, or an error line. */
export function hire(crew: Crew, id: string): { crew: Crew; error?: string } {
  if (!isHire(id)) return { crew, error: 'NOBODY BY THAT NAME' };
  if (crew.hired.includes(id)) return { crew, error: `${HIRES[id].name.toUpperCase()} IS ALREADY ABOARD` };
  return { crew: { hired: [...crew.hired, id] } };
}

export function has(crew: Crew, id: HireId): boolean {
  return crew.hired.includes(id);
}

/** Multiplier on hull repair costs. */
export function repairMultiplier(crew: Crew): number {
  return has(crew, 'brennick-mechanic') ? 1 - REPAIR_DISCOUNT : 1;
}

const KEY = 'vanguard.crew.v1';

export function loadCrew(): Crew {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normaliseCrew(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return newCrew();
}

export function saveCrew(c: Crew): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* session only */
  }
}
