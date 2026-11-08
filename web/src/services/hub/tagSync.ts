import type { TagRegistry } from '../../domain';
import type { HubApi, HubTagEntry } from './HubApi';

export function hubMatchesRegistry(hubTags: Record<string, HubTagEntry>, registry: TagRegistry): boolean {
  const ids = Object.keys(registry);
  if (ids.length !== Object.keys(hubTags).length) return false;
  return ids.every((id) => {
    const mine = registry[Number(id)];
    const theirs = hubTags[id];
    return mine !== undefined && theirs !== undefined && theirs.patient_id === mine.code && theirs.display_name === mine.boardName;
  });
}

export async function syncRegistryToHub(hub: HubApi, registry: TagRegistry): Promise<number | null> {
  const current = await hub.getTags();
  if (hubMatchesRegistry(current, registry)) return null;
  return hub.replaceTags(registry);
}
