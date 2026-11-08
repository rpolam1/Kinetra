import { MAX_TAG_ID } from '../domain';
import type { TagRegistry } from '../domain';

export function lowestFreeTag(tags: TagRegistry): number | null {
  for (let id = 0; id <= MAX_TAG_ID; id += 1) {
    if (!(id in tags)) return id;
  }
  return null;
}

export interface Registry {
  nextCode: number;
  tags: TagRegistry;
}

export function emptyRegistry(): Registry {
  return { nextCode: 1, tags: {} };
}
