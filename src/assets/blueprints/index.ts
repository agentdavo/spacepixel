import type { Blueprint } from '../Blueprint';
import { KESTREL } from './concord';
import { CANTOR, CATHEDRAL } from './choir';

export { KESTREL, CANTOR, CATHEDRAL };

export const BLUEPRINTS: Record<string, Blueprint> = Object.fromEntries(
  [KESTREL, CANTOR, CATHEDRAL].map((b) => [b.id, b]),
);
