/**
 * Tiny in-memory memo for API responses. Every open tab polls the same
 * endpoints every few seconds; with this they share one computation per
 * interval instead of each running the queries again.
 */
interface Entry {
  at: number;
  value?: unknown;
  pending?: Promise<unknown>;
}

const MAX_ENTRIES = 200;
const store = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => T | Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.value !== undefined && now - hit.at < ttlMs) return hit.value as T;
  if (hit?.pending) return hit.pending as Promise<T>; // already being computed: wait for that

  const pending = Promise.resolve()
    .then(fn)
    .then(
      (value) => {
        store.delete(key); // re-insert so the newest entries are last
        store.set(key, { at: Date.now(), value });
        if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
        return value;
      },
      (err) => {
        store.delete(key);
        throw err;
      }
    );
  store.set(key, { at: hit?.at ?? 0, value: hit?.value, pending });
  return pending;
}
