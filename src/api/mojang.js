import { UserError } from '../util.js';

const cache = new Map();
const TTL = 10 * 60 * 1000;

/** @returns {Promise<{uuid: string, name: string} | null>} */
export async function getUuid(name) {
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;

  const res = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new UserError('Mojang API is unavailable, try again later.');
  const j = await res.json();
  const v = { uuid: j.id, name: j.name };
  cache.set(key, { v, t: Date.now() });
  return v;
}
