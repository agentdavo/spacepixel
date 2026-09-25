import type { CommodityId, TradeLedger } from '../economy.ts';
export interface ContactAssignment {
  id: string; polity: 'pelagic' | 'mantle'; system: string; title: string; jaTitle: string;
  brief: string; jaBrief: string; cargo: CommodityId; units: number; reward: number; after?: string;
}
/** Initial economic contact arcs. Escort/combat branches and voiced characters are later U04 work. */
export const CONTACT_ASSIGNMENTS: ContactAssignment[] = [
  { id: 'pelagic-1', polity: 'pelagic', system: 'marches:threshold', title: 'A safe arrival', jaTitle: '安全な到着', brief: 'The contact harbor has opened a rescue berth. Deliver two cases of medicine so its crew can treat arriving survey pilots.', jaBrief: '連絡港に救助用バースが開設されました。調査員を治療するため、医薬品を2ケース届けてください。', cargo: 'medical', units: 2, reward: 1100 },
  { id: 'pelagic-2', polity: 'pelagic', system: 'marches:stillwater', title: 'Pressure holds', jaTitle: '気密の維持', brief: 'Stillwater needs four crates of spares for its pressure seals. Deliver them before the next convoy relies on the habitat.', jaBrief: 'スティルウォーターの気密シールの修理に、予備部品が4箱必要です。次の船団が到着する前に届けてください。', cargo: 'spares', units: 4, reward: 2200, after: 'pelagic-1' },
  { id: 'pelagic-3', polity: 'pelagic', system: 'marches:shelter', title: 'An open berth', jaTitle: '開かれたバース', brief: 'The assemblies will stock a shared refuge if independent pilots deliver food. Bring eight pallets of rations to Shelter.', jaBrief: '共同避難港に食料を備蓄します。シェルターに糧食を8パレット届けてください。', cargo: 'rations', units: 8, reward: 1600, after: 'pelagic-2' },
  { id: 'mantle-1', polity: 'mantle', system: 'marches:foundry', title: 'A working promise', jaTitle: '実務の約束', brief: 'The repair council has agreed to service foreign hulls. Deliver three crates of spares to Common Foundry.', jaBrief: '修理評議会が異国の船の整備を引き受けました。コモン・ファウンドリーへ予備部品を3箱届けてください。', cargo: 'spares', units: 3, reward: 1800 },
  { id: 'mantle-2', polity: 'mantle', system: 'marches:survey-006', title: 'Fuel for the cutters', jaTitle: '採掘船の燃料', brief: 'Independent cutters cannot move their supplies without fuel. Deliver two flasks of Ebon-gas to the sixth Marches system.', jaBrief: '独立採掘船が物資を運ぶために燃料を必要としています。マーチズ第6星系にエボンガスを2瓶届けてください。', cargo: 'ebon', units: 2, reward: 3300, after: 'mantle-1' },
  { id: 'mantle-3', polity: 'mantle', system: 'marches:survey-005', title: 'Shared maintenance', jaTitle: '共同整備', brief: 'A survey outpost will share its workshop with both peoples. Deliver a sealed reactor core to bring the workshop online.', jaBrief: '調査拠点の工房を両者で共有します。工房を稼働させるため、密封された原子炉コアを1基届けてください。', cargo: 'cores', units: 1, reward: 2600, after: 'mantle-2' },
];
export interface ContactProgress { version: 1; completed: string[]; }
/** Unsupported documents are carried through trade saves without interpreting their fields. */
export type ContactState = ContactProgress | Readonly<Record<string, unknown>>;
export function isContactProgress(raw: unknown): raw is ContactProgress {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Partial<ContactProgress>;
  return r.version === 1 && Array.isArray(r.completed) && r.completed.every(id => typeof id === 'string');
}
export function contactBlocked(ledger: TradeLedger): boolean {
  return ledger.contact !== undefined && !isContactProgress(ledger.contact);
}
export function normalizeContact(raw: unknown): ContactState {
  if (!raw || typeof raw !== 'object') return { version: 1, completed: [] };
  if (Object.hasOwn(raw, 'version') && (raw as { version: unknown }).version !== 1) return raw as Readonly<Record<string, unknown>>;
  const r = raw as Partial<ContactProgress>;
  const known = new Set(CONTACT_ASSIGNMENTS.map(a => a.id));
  const requested = new Set(Array.isArray(r.completed) ? r.completed.filter(id => known.has(id)) : []);
  // Ignore orphaned completions from invalid/edited saves.
  const completed: string[] = [];
  for (const a of CONTACT_ASSIGNMENTS) if (requested.has(a.id) && (!a.after || completed.includes(a.after))) completed.push(a.id);
  return { version: 1, completed };
}
export function contactAvailable(ledger: TradeLedger, a: ContactAssignment): boolean {
  if (contactBlocked(ledger)) return false;
  const done = isContactProgress(ledger.contact) ? ledger.contact.completed : [];
  return !done.includes(a.id) && (!a.after || done.includes(a.after));
}
export function deliverContact(ledger: TradeLedger, station: string, assignment: string): { ledger: TradeLedger; error?: string } {
  if (contactBlocked(ledger)) return { ledger, error: 'Contact records use an unsupported version. Update Vanguard to continue these agreements; saved records are preserved.' };
  const a = CONTACT_ASSIGNMENTS.find(x => x.id === assignment);
  if (!a || !contactAvailable(ledger, a)) return { ledger, error: 'Assignment unavailable or already completed' };
  if (!station.startsWith(`${a.system}-`)) return { ledger, error: `Deliver at ${a.system}` };
  if ((ledger.cargo[a.cargo] ?? 0) < a.units) return { ledger, error: `Requires ${a.units} ${a.cargo}` };
  // One ledger value contains cargo, payment, standing AND receipt: a reload cannot pay twice.
  return { ledger: { ...ledger, credits: ledger.credits + a.reward,
    cargo: { ...ledger.cargo, [a.cargo]: (ledger.cargo[a.cargo] ?? 0) - a.units },
    rep: { ...ledger.rep, [a.polity]: Math.min(100, (ledger.rep[a.polity] ?? 0) + 5) },
    contact: { version: 1, completed: [...(isContactProgress(ledger.contact) ? ledger.contact.completed : []), a.id] },
  } };
}
