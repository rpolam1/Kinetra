import type { TagRegistry } from '../../domain';
import type { HubApi, HubTagEntry } from './HubApi';

/** Whether the hub already has exactly the same tags as the registry. */
export function hubMatchesRegistry(hubTags: Record<string, HubTagEntry>, registry: TagRegistry): boolean {
  const ids = Object.keys(registry);
  if (ids.length !== Object.keys(hubTags).length) return false;
  return ids.every((id) => {
    const mine = registry[Number(id)];
    const theirs = hubTags[id];
    return mine !== undefined && theirs !== undefined && theirs.patient_id === mine.code && theirs.display_name === mine.boardName;
  });
}

/** Send the registry to the hub only when it differs. Returns the number of tags written, or null when nothing needed sending. */
export async function syncRegistryToHub(hub: HubApi, registry: TagRegistry): Promise<number | null> {
  const current = await hub.getTags();
  if (hubMatchesRegistry(current, registry)) return null;
  return hub.replaceTags(registry);
}
