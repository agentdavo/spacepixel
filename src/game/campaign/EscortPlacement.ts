import type { SpawnSpec } from './types';

/** Keep spawn placement and stable destination-lane ordering in agreement. */
export function memberOffset(spec: SpawnSpec, member: number): [number, number, number] {
  return spec.memberOffsets?.[member] ?? [
    (member % 2 ? 1 : -1) * Math.ceil(member / 2) * 60,
    (member % 3) * 12,
    -Math.ceil(member / 2) * 45,
  ];
}
