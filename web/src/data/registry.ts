import { MAX_TAG_ID } from '../domain';
import type { TagRegistry } from '../domain';

/** The lowest tag number that is not used, or null when every tag is taken. */
export function lowestFreeTag(tags: TagRegistry): number | null {
  for (let id = 0; id <= MAX_TAG_ID; id += 1) {
    if (!(id in tags)) return id;
  }
  return null;
}

/** The next patient code number and the tags in use, kept together so a free one can be found. */
export interface Registry {
  nextCode: number;
  tags: TagRegistry;
}

export function emptyRegistry(): Registry {
  return { nextCode: 1, tags: {} };
}
