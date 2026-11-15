import { config } from '../config.js';
import { UserError } from '../util.js';

/**
 * Urchin (Coral) API client.
 *
 * Tags endpoint: GET /v3/player/tags?player=<name|uuid>
 * Set DEBUG_API=true in .env to print the raw status and body of every Urchin request.
 */

async function urchinGet(pathTemplate, vars, { soft = false } = {}) {
  if (!config.urchin.key) throw new UserError('Urchin API key is not configured.');
  let path = pathTemplate;
  for (const [k, v] of Object.entries(vars)) path = path.replaceAll(`{${k}}`, encodeURIComponent(v));

  const url = config.urchin.baseUrl + path;
  const res = await fetch(url, {
    headers: { [config.urchin.authHeader]: config.urchin.key, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  // Log the status and raw body (before any error handling) so a wrong path or shape is visible.
  if (config.urchin.debug) {
    const body = await res.clone().text();
    console.log(`[Urchin] ${res.status} ${url}\n${body.slice(0, 2000)}`);
  }

  // soft: 404/400/405/422 mean "this path/shape isn't right" -> undefined so the caller can try another path
  if (soft && [400, 404, 405, 422].includes(res.status)) return undefined;
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new UserError('Urchin API key was rejected.');
  if (res.status === 429) throw new UserError('Urchin API is rate limited, try again in a moment.');
  if (!res.ok) throw new UserError(`Urchin API error (${res.status}).`);
  return res.json();
}

/** Find the tag array wherever it is nested in the response. */
function findTagArray(node, depth = 0) {
  if (!node || depth > 4) return null;
  if (Array.isArray(node)) return node;
  if (Array.isArray(node.tags)) return node.tags;
  for (const key of ['data', 'player', 'result']) {
    const found = findTagArray(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** @returns {Promise<Array<{type: string, reason: string|null}>>} */
export async function getTags(player) {
  const json = await urchinGet(config.urchin.tagsPath, { player });
  if (!json) return [];
  const list = findTagArray(json) ?? [];
  return list.map((t) => ({
    type: String(t.tag_type ?? t.type ?? t.tag ?? t.name ?? t.label ?? t.category ?? 'unknown'),
    reason: t.reason ?? t.description ?? null,
  }));
}

const SESSION_FALLBACKS = [
  '/v3/player/session?player={player}&duration={duration}',
  '/v3/player/sessions?player={player}&duration={duration}',
  '/v3/session?player={player}&duration={duration}',
  '/v3/player/session/{player}?duration={duration}',
];
let workingSessionPath = null; // remembered once a path answers

/**
 * Session stats gained over a period, e.g. duration "24h", "7d", "30d".
 * Tries URCHIN_SESSION_PATH first, then a few likely paths, and remembers the one that works.
 * @returns {Promise<{since: string|null, delta: Record<string, any>|null} | null>} null = no usable endpoint/data
 */
export async function getSession(player, duration) {
  const candidates = [...new Set([workingSessionPath, config.urchin.sessionPath, ...SESSION_FALLBACKS].filter(Boolean))];
  for (const pathTemplate of candidates) {
    const json = await urchinGet(pathTemplate, { player, duration }, { soft: true });
    if (json === undefined || json === null) continue;
    if (workingSessionPath !== pathTemplate) {
      workingSessionPath = pathTemplate;
      console.log(`[Urchin] Session endpoint works: ${pathTemplate} (put it in URCHIN_SESSION_PATH)`);
    }
    const root = json.data ?? json.session ?? json;
    return {
      since: root.since_readable ?? root.sinceReadable ?? null,
      delta: root.delta ?? root.diff ?? root.gained ?? null,
    };
  }
  console.warn(
    `[Urchin] No session endpoint answered for ${player} (${duration}). Tried: ${candidates.join(' , ')}. ` +
      'Set DEBUG_API=true and check URCHIN_SESSION_PATH against https://api.urchin.gg',
  );
  return null;
}

const norm = (k) => String(k).toLowerCase().replace(/[^a-z]/g, '');

/** Flatten nested numeric stats into Map<normalisedKey, number>; first occurrence wins. */
function flatten(node, out = new Map(), depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return out;
  for (const [k, v] of Object.entries(node)) {
    const key = norm(k);
    let n = null;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) n = Number(v);
    else if (v && typeof v === 'object') {
      const inner = v.delta ?? v.diff ?? v.gained ?? v.change ?? v.value;
      if (typeof inner === 'number') n = inner;
      else flatten(v, out, depth + 1);
    }
    if (n !== null && !out.has(key)) out.set(key, n);
  }
  return out;
}

/** Prefer the Bedwars sub-object when the delta covers several games. */
function bedwarsNode(delta, depth = 0) {
  if (!delta || typeof delta !== 'object' || depth > 2) return null;
  for (const [k, v] of Object.entries(delta)) {
    if (norm(k) === 'bedwars' && v && typeof v === 'object') return v;
  }
  for (const v of Object.values(delta)) {
    const found = bedwarsNode(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Turn an Urchin delta object into a short one-line summary. Returns null if there is nothing to show. */
export function formatDelta(delta) {
  if (!delta || typeof delta !== 'object' || Object.keys(delta).length === 0) return null;
  const flat = flatten(bedwarsNode(delta) ?? delta);
  const pick = (...needles) => needles.map((n) => flat.get(n)).find((v) => v !== undefined);

  const wins = pick('wins', 'winsbedwars', 'bedwarswins');
  const losses = pick('losses', 'lossesbedwars', 'bedwarslosses');
  const fk = pick('finalkills', 'finalkillsbedwars', 'bedwarsfinalkills');
  const fd = pick('finaldeaths', 'finaldeathsbedwars', 'bedwarsfinaldeaths');
  const bb = pick('bedsbroken', 'bedsbrokenbedwars', 'bedwarsbedsbroken');
  const bl = pick('bedslost', 'bedslostbedwars', 'bedwarsbedslost');

  const known = [wins, losses, fk, fd, bb, bl].filter((v) => v !== undefined);
  if (known.length) {
    if (known.every((v) => v === 0)) return null; // nothing played in that period
    const ratio = (a, b) => (b === 0 ? a.toFixed(2) : (a / b).toFixed(2));
    const parts = [];
    if (wins !== undefined) parts.push(`W ${wins}`);
    if (losses !== undefined) parts.push(`L ${losses}`);
    if (wins !== undefined && losses !== undefined) parts.push(`WLR ${ratio(wins, losses)}`);
    if (fk !== undefined) parts.push(`FK ${fk}`);
    if (fd !== undefined) parts.push(`FD ${fd}`);
    if (fk !== undefined && fd !== undefined) parts.push(`FKDR ${ratio(fk, fd)}`);
    if (bb !== undefined) parts.push(`BB ${bb}`);
    if (bb !== undefined && bl !== undefined) parts.push(`BBLR ${ratio(bb, bl)}`);
    return parts.join(' | ');
  }

  // Unknown shape: show the first few non-zero numeric entries so the output is still useful.
  const rest = [...flat.entries()].filter(([, v]) => v !== 0).slice(0, 6);
  return rest.length ? rest.map(([k, v]) => `${k} ${v}`).join(' | ') : null;
}
