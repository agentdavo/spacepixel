import type { GameScene } from '../GameScene';

/** Scene registry: `?scene=<name>`. Lazy so each scene only loads what it needs. */
export const SCENES: Record<string, () => Promise<GameScene>> = {
  flight: async () => new (await import('./FlightScene')).FlightScene(),
  showcase: async () => new (await import('../ShowcaseScene')).ShowcaseScene(),
  spatial: async () => new (await import('./SpatialTestScene')).SpatialTestScene(),
  hangar: async () => new (await import('./HangarScene')).HangarScene(),
  dogfight: async () => new (await import('./DogfightScene')).DogfightScene(),
  fx: async () => new (await import('./FxTestScene')).FxTestScene(),
};

export const DEFAULT_SCENE = 'flight';
