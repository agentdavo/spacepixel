import type { GameScene } from '../GameScene';

/** Scene registry: `?scene=<name>`. Lazy so each scene only loads what it needs. */
export const SCENES: Record<string, () => Promise<GameScene>> = {
  flight: async () => new (await import('./FlightScene')).FlightScene(),
  showcase: async () => new (await import('../ShowcaseScene')).ShowcaseScene(),
  spatial: async () => new (await import('./SpatialTestScene')).SpatialTestScene(),
  hangar: async () => new (await import('./HangarScene')).HangarScene(),
  paint: async () => new (await import('./PaintShopScene')).PaintShopScene(),
  dogfight: async () => new (await import('./DogfightScene')).DogfightScene(),
  combat: async () => new (await import('./CombatTestScene')).CombatTestScene(),
  fx: async () => new (await import('./FxTestScene')).FxTestScene(),
  comms: async () => new (await import('./CommsTestScene')).CommsTestScene(),
  setpieces: async () => new (await import('./SetPieceScene')).SetPieceScene(),
  audio: async () => new (await import('./AudioTestScene')).AudioTestScene(),
  prologue: async () => new (await import('./PrologueScene')).PrologueScene(),
  trailer: async () => new (await import('./TrailerScene')).TrailerScene(),
  kessen: async () => new (await import('./KessenTestScene')).KessenTestScene(),
  'kessen-assault': async () => new (await import('./KessenAssaultScene')).KessenAssaultScene(),
};

export const DEFAULT_SCENE = 'flight';
