/** Evidence-oriented milestone status. Counts never imply art, language or gameplay acceptance. */
export const EXPANSION_MILESTONES = [
  { id: 'U00', name: 'Universe charter', status: 'authorized', remaining: 'Names and count ranges remain editable during prototype review.' },
  { id: 'U01', name: 'Content and saves', status: 'foundation', remaining: 'Audit remaining legacy faction assumptions and migrate additional affected stores when their schema changes.' },
  { id: 'U02', name: 'Civilization prototypes', status: 'blockouts', remaining: 'Anatomy, bespoke station kits, final hull art, pronunciation direction and voice reels.' },
  { id: 'U03', name: 'Languages and localization', status: 'foundation', remaining: 'Expand the 24-root/12-line pilot corpora, extract remaining UI, review Japanese, produce other locale bundles and recorded speech.' },
  { id: 'U04', name: 'First-contact sector', status: 'prototype', remaining: 'Six courier agreements are implemented; authored characters, choices, escort/combat branches and a complete recorded playthrough remain.' },
  { id: 'U05', name: 'Regional simulation', status: 'foundation', remaining: 'Atlas and six-system flight pilot are separate; full regional streaming, diplomacy and economic consequences remain.' },
  { id: 'U06', name: 'Fleet production', status: 'started', remaining: 'Eight prototype hulls; remaining production fleets, authored subsystem atlas and detachable component work remain.' },
  { id: 'U07', name: 'Regional releases', status: 'manifests', remaining: 'Four staged waves have manifests; later regions have survey descriptions, not completed playable content.' },
  { id: 'U08', name: 'Expansion acceptance', status: 'not accepted', remaining: 'Automated checks cover foundations. Native performance, art, voice, language review and human playthrough gates remain open.' },
] as const;
