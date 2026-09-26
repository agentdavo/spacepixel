/** One atomic storage record for purchases that change both money and ships.
 * Legacy trade/hangar keys remain untouched as a migration fallback. Once this
 * record exists, every ledger/hangar writer must update it, not those old keys.
 */
export const CAREER_KEY = 'vanguard.career.v1';
export interface CareerRecord { version: 1; ledger: object; hangar: object }
// A session that started from fallback objects must never overwrite the real
// career if access later recovers. Only a fresh page can reconcile all owners.
let loadFailed = false;
export function blockCareerWrites(): void { loadFailed = true; }
export function careerWritable(): boolean { return !loadFailed; }

export function readCareer(): CareerRecord | null {
  const raw = localStorage.getItem(CAREER_KEY);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !value.ledger || typeof value.ledger !== 'object' ||
      Array.isArray(value.ledger) || !value.hangar || typeof value.hangar !== 'object' || Array.isArray(value.hangar)) {
    throw new Error('Unsupported or damaged career save');
  }
  return value;
}

/** setItem is the single commit point: failure leaves the previous pair intact. */
export function writeCareer(ledger: object, hangar: object): boolean {
  if (!careerWritable()) return false;
  try {
    readCareer(); // Never overwrite an unreadable/future record with defaults.
    localStorage.setItem(CAREER_KEY, JSON.stringify({ version: 1, ledger, hangar }));
    return true;
  } catch { return false; }
}

export function saveFailureMessage(): string {
  return loadFailed
    ? 'COULD NOT SAVE — SAVE DATA WAS NOT LOADED. RESTORE STORAGE ACCESS AND RELOAD BEFORE TRADING.'
    : 'COULD NOT SAVE — NOTHING CHANGED. CHECK BROWSER STORAGE AND TRY AGAIN.';
}
