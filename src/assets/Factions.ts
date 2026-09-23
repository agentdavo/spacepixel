import type { FactionId, Livery } from './Blueprint';

export interface Faction {
  id: FactionId;
  name: string;
  short: string;
  motto: string;
  livery: Livery;
}

/**
 * Internal ids are stable: concord = Terran Directorate, choir = Zenith
 * Hegemony, rustwake = the Ebon-gas scavenger clans. See docs/LORE.md. Liveries are deliberately limited
 * palettes — three body colours and one hot accent — the way 90s mechanical
 * designers specified model sheets for the ink-and-paint department.
 */
export const FACTIONS: Record<FactionId, Faction> = {
  concord: {
    id: 'concord',
    name: 'Terran Directorate',
    short: 'TD',
    motto: 'What was built can be kept. What is kept can be flown.',
    livery: {
      primary: '#eceae4',
      secondary: '#2b4ea8',
      accent: '#ff7a1c',
      dark: '#2a2d3a',
      metal: '#8d94a8',
      glass: '#3fd0ff',
      glow: '#56c8ff',
      plumeCore: '#e8fbff',
    },
  },
  choir: {
    id: 'choir',
    name: 'Zenith Hegemony',
    short: 'ZH',
    motto: 'Ascend, or be kept.',
    livery: {
      primary: '#5d4a86',
      secondary: '#1d1729',
      accent: '#ff3fa8',
      dark: '#140f1c',
      metal: '#77709a',
      glass: '#ff5fd0',
      glow: '#ff4fd8',
      plumeCore: '#fff0fb',
    },
  },
  rustwake: {
    id: 'rustwake',
    name: 'Rustwake Ebon-Gas Clans',
    short: 'RWK',
    motto: 'Nothing in the black is ever truly lost.',
    livery: {
      primary: '#b0643a',
      secondary: '#5d6b3f',
      accent: '#ffd21f',
      dark: '#2e2622',
      metal: '#8f8a7e',
      glass: '#9fffb0',
      glow: '#ffae4f',
      plumeCore: '#fff6e0',
    },
  },
};
