import { useCallback, useEffect, useRef } from 'react';
import { syncRegistryToHub } from '../../services/hub/tagSync';
import { useData } from '../providers/DataProvider';
import { useHub } from '../providers/HubProvider';
import { useToast } from '../providers/ToastProvider';

/** Returns a function that sends the tag registry to the hub. With quiet set no message is shown. */
export function useTagSync() {
  const { patients } = useData();
  const { api } = useHub();
  const toast = useToast();

  return useCallback(
    async (options: { quiet?: boolean } = {}): Promise<number | null | undefined> => {
      try {
        const registry = await patients.tagRegistry();
        const written = await syncRegistryToHub(api, registry);
        if (!options.quiet) {
          toast.success(written === null ? 'The hub already has the latest tags.' : `Sent ${written} tag(s) to the hub.`);
        }
        return written;
      } catch (e) {
        if (!options.quiet) toast.error(e instanceof Error ? e.message : 'Could not sync tags to the hub');
        return undefined;
      }
    },
    [patients, api, toast],
  );
}

/** Send the tags to the hub whenever it comes online. */
export function useAutoTagSync(): void {
  const sync = useTagSync();
  const { status } = useHub();
  // A ref keeps the effect from running again when the sync function is recreated
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (status === 'online') void syncRef.current({ quiet: true });
  }, [status]);
}
