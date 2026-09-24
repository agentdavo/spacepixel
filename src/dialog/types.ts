/**
 * Dialog data contract. Conversations are plain data — nodes with a speaker
 * and a line, choices gated by conditions, effects on the world — so the
 * writing lives in conversations.ts and the engine (engine.ts) is a handful
 * of pure functions under test (tests/dialog.test.ts).
 *
 * Lines may use {vars}: {station} {system} {callsign} {tip} {rumour} {name}.
 */
export type DFaction = 'concord' | 'choir' | 'rustwake';
export type DCommodity = 'ebon' | 'relics' | 'cores' | 'spares' | 'rations' | 'munitions' | 'medical' | 'luxury';
export type DStationKind = 'refinery' | 'salvage' | 'bastion' | 'freeport' | 'orbital' | 'carrier' | 'surface';

export type Cond =
  | { flag: string }
  | { notFlag: string }
  | { episode: { min?: number; max?: number } }
  | { standing: DFaction; min?: number; max?: number }
  | { credits: number }
  | { cargo: DCommodity; min?: number; max?: number }
  | { cargoSpace: number }
  | { stationFaction: DFaction | DFaction[] }
  | { stationKind: DStationKind | DStationKind[] }
  | { seen: string; min?: number; max?: number }
  /** A world fact (src/game/world/WorldState.ts: `bastion.fallen`, `continuity.hostile`, …); `is` matches a value. */
  | { worldFact: string; is?: string | boolean }
  | { notWorldFact: string }
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond };

export type Effect =
  | { setFlag: string }
  | { clearFlag: string }
  | { standing: DFaction; delta: number }
  /** + gives shares to the player, − takes them. */
  | { credits: number }
  /** + gives cargo, − takes it. */
  | { cargo: DCommodity; delta: number }
  | { codex: string }
  | { rumour: string }
  /** A trade tip for the notebook ('{tip}' = the station's live price tip). */
  | { tip: string }
  /** Hook for the contracts board: offer this contract id. */
  | { contract: string }
  /** Hook for recruitment / hiring (wingmen, crew). */
  | { recruit: string };

export interface DialogChoice {
  /** What the Point says (the player is silent on the radio, not at the bar). */
  text: string;
  /** Next node id; null ends the conversation. */
  next: string | null;
  if?: Cond;
  effects?: Effect[];
  /** Show greyed out with this hint when the condition fails (default: hidden). */
  locked?: string;
}

export interface DialogNode {
  /** Speaker: a person id, a cast id, or 'self' for a narrated action. */
  who: string;
  line: string;
  jp?: string;
  /** Applied when the node is entered. */
  effects?: Effect[];
  /** Auto-advance to this node after the line (when there are no choices). */
  next?: string;
  choices?: DialogChoice[];
}

export interface Conversation {
  id: string;
  title: string;
  /** Person id this conversation belongs to. */
  with: string;
  /** Offered only when this holds. */
  when?: Cond;
  /** Entry node by condition, first match wins (last entry usually unconditional). */
  entry: { if?: Cond; node: string }[];
  nodes: Record<string, DialogNode>;
  /** Ordering when a person has several conversations (higher first). */
  priority?: number;
  /** Can be had again after finishing (default true). */
  repeatable?: boolean;
}

/** Persistent dialog memory (localStorage via state.ts). */
export interface DialogState {
  flags: Record<string, true>;
  /** Conversation id → times finished. */
  seen: Record<string, number>;
  rumours: string[];
  tips: string[];
  codex: string[];
  contracts: string[];
  recruits: string[];
}

/** The slice of the trade ledger dialog can read and change. */
export interface DLedger {
  credits: number;
  cargo: Partial<Record<DCommodity, number>>;
  capacity: number;
  rep: Record<DFaction, number>;
}

export interface DialogWorld {
  state: DialogState;
  ledger: DLedger;
  episode: number;
  station?: { id: string; faction: DFaction; kind: DStationKind };
  vars?: Record<string, string>;
  /** The Reach's facts (world state); missing = none known. */
  facts?: Readonly<Record<string, string | boolean>>;
}
