/**
 * storage.js
 * The only module that reads or writes localStorage (SPEC §5, §6).
 * Every key is prefixed with "hockeydj." and every value is JSON.
 */

const PREFIX = 'hockeydj.';
const APP_ID = 'hockey-dj';

/** Version of the stored playlist format and of export files (SPEC §5.4). */
export const SCHEMA_VERSION = 2;

const KEY_SETTINGS = 'settings';
const KEY_AUTH = 'auth';
const KEY_PLAYLISTS = 'playlists';
const KEY_GAME = 'game';
const KEY_PKCE = 'pkce';
const KEY_TRACK_LINKS = 'trackLinks';

const MAX_NAME_LENGTH = 80;
const MAX_TEXT_LENGTH = 300;
const MIN_TAIL_MS = 1000;
const TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

/** Value of `settings.deviceId` meaning "this browser's own Spotify player" (SPEC §3.4). */
export const BROWSER_DEVICE_ID = 'browser';

/** Number of game buttons (G-10). */
export const BUTTON_COUNT = 4;

const DEFAULT_SETTINGS = Object.freeze({
  language: null,
  theme: null,
  clientId: '',
  deviceId: null,
  activePlaylistId: null,
  buttons: Object.freeze(Array(BUTTON_COUNT).fill(null)),
  advanceAfterPlayedMs: null,
  advanceAfterIdleMs: null,
  shuffle: true,
});

const DEFAULT_GAME = Object.freeze({
  currentIndex: 0,
  positionMs: null,
  playedMs: 0,
  stoppedAt: null,
  shuffle: null,
  prepared: null,
});

/* ---------- Low-level access ---------- */

function read(name) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(name, value) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Hockey DJ: could not save "${name}".`, error);
    return false;
  }
}

function remove(name) {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    /* Storage unavailable: nothing to remove. */
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Returns a new unique identifier. */
export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------- Settings ---------- */

/** Returns exactly BUTTON_COUNT entries, each a playlist ID or null, with no ID twice (G-10). */
function cleanButtons(value) {
  const seen = new Set();
  return Array.from({ length: BUTTON_COUNT }, (_, slot) => {
    const id = Array.isArray(value) ? value[slot] : null;
    if (typeof id !== 'string' || !id || seen.has(id)) return null;
    seen.add(id);
    return id;
  });
}

/** Returns the settings merged with their defaults. */
export function getSettings() {
  const stored = read(KEY_SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...(isObject(stored) ? stored : {}) };
  // Settings saved before game buttons existed: the active playlist gets button 1 (SPEC §5.4).
  const buttons = isObject(stored) && !('buttons' in stored) ? [settings.activePlaylistId] : settings.buttons;
  return { ...settings, buttons: cleanButtons(buttons) };
}

/** Merges a patch into the settings, saves them and returns the result. */
export function updateSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEY_SETTINGS, next);
  return next;
}

/* ---------- Authentication ---------- */

/** Returns the stored tokens, or null. */
export function getAuth() {
  const auth = read(KEY_AUTH);
  return isObject(auth) ? auth : null;
}

/** Saves the tokens. */
export function setAuth(auth) {
  write(KEY_AUTH, auth);
}

/** Deletes the tokens. */
export function clearAuth() {
  remove(KEY_AUTH);
}

/** Returns the temporary PKCE values kept during the login redirect, or null. */
export function getPkce() {
  const pkce = read(KEY_PKCE);
  return isObject(pkce) ? pkce : null;
}

/** Saves the temporary PKCE values. */
export function setPkce(pkce) {
  write(KEY_PKCE, pkce);
}

/** Deletes the temporary PKCE values. */
export function clearPkce() {
  remove(KEY_PKCE);
}

/* ---------- Game state (SPEC §4.2.1, R-10) ---------- */

/** Returns a fresh game state for one playlist. */
export function defaultGame() {
  return { ...DEFAULT_GAME };
}

/**
 * Returns the saved game state of every playlist, keyed by playlist ID, each merged with its defaults.
 * An old single game state (before spec 1.2) becomes the entry of the active playlist (SPEC §5.4).
 */
export function getGames() {
  const stored = read(KEY_GAME);
  if (!isObject(stored)) return {};
  let entries = stored.playlists;
  if (!isObject(entries)) {
    const activeId = getSettings().activePlaylistId;
    entries = activeId && 'currentIndex' in stored ? { [activeId]: stored } : {};
  }
  const games = {};
  for (const [id, game] of Object.entries(entries)) {
    if (isObject(game)) games[id] = { ...DEFAULT_GAME, ...game };
  }
  return games;
}

/** Saves the game state of every playlist. */
export function setGames(games) {
  write(KEY_GAME, { playlists: games });
}

/* ---------- Track links (SPEC §3.4) ---------- */

/** Returns the learned links, `{ requestedTrackId: playedTrackId }`, keeping only valid IDs. */
export function getTrackLinks() {
  const stored = read(KEY_TRACK_LINKS);
  const links = {};
  if (!isObject(stored)) return links;
  for (const [requested, played] of Object.entries(stored)) {
    if (TRACK_ID_PATTERN.test(requested) && typeof played === 'string' && TRACK_ID_PATTERN.test(played)) links[requested] = played;
  }
  return links;
}

/** Saves that Spotify plays `playedId` when asked for `requestedId`, and returns all links. */
export function setTrackLink(requestedId, playedId) {
  const links = getTrackLinks();
  if (TRACK_ID_PATTERN.test(requestedId) && TRACK_ID_PATTERN.test(playedId)) {
    links[requestedId] = playedId;
    write(KEY_TRACK_LINKS, links);
  }
  return links;
}

/* ---------- Playlists ---------- */

function migrate(data) {
  if (!isObject(data) || !Array.isArray(data.playlists)) return null;
  let { schemaVersion = 1, playlists } = data;
  // Steps run oldest first. Version 2 adds an optional end to each track (P-10).
  if (schemaVersion < 2) {
    playlists = playlists.map((playlist) => ({
      ...playlist,
      tracks: (playlist.tracks || []).map((track) => ({ ...track, endMs: null })),
    }));
    schemaVersion = 2;
  }
  return { ...data, schemaVersion, playlists };
}

/** Returns all playlists. */
export function getPlaylists() {
  const data = migrate(read(KEY_PLAYLISTS));
  return data ? data.playlists : [];
}

/** Saves all playlists. Returns false if the browser refused to store them. */
export function savePlaylists(playlists) {
  return write(KEY_PLAYLISTS, { schemaVersion: SCHEMA_VERSION, playlists });
}

/* ---------- Export and import (SPEC §4.4, §5.3) ---------- */

function cleanTrack(track) {
  const { id, uri, name, artists, imageUrl, durationMs, startMs, endMs = null } = track;
  return { id, uri, name, artists, imageUrl, durationMs, startMs, endMs };
}

function cleanPlaylist(playlist) {
  const { id, name, createdAt, updatedAt, tracks } = playlist;
  return { id, name, createdAt, updatedAt, tracks: tracks.map(cleanTrack) };
}

/** Builds the JSON text of an export file. It never contains tokens or the Client ID. */
export function buildExport(playlists) {
  const data = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    playlists: playlists.map(cleanPlaylist),
  };
  return JSON.stringify(data, null, 2);
}

/** Error thrown by parseImport. `code` is "invalid", "newer" or "empty". */
export class ImportError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ImportError';
    this.code = code;
  }
}

function sanitizeTrack(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || !TRACK_ID_PATTERN.test(raw.id)) return null;
  const durationMs = Math.round(Number(raw.durationMs));
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const rawStart = Math.round(Number(raw.startMs));
  const startMs = Number.isFinite(rawStart) ? clamp(rawStart, 0, Math.max(0, durationMs - MIN_TAIL_MS)) : 0;
  const rawEnd = raw.endMs == null ? NaN : Math.round(Number(raw.endMs));
  const endMs = Number.isFinite(rawEnd) && rawEnd >= startMs + MIN_TAIL_MS && rawEnd < durationMs ? rawEnd : null;
  return {
    id: raw.id,
    uri: `spotify:track:${raw.id}`,
    name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_TEXT_LENGTH) : '',
    artists: Array.isArray(raw.artists)
      ? raw.artists.filter((artist) => typeof artist === 'string').map((artist) => artist.slice(0, MAX_TEXT_LENGTH))
      : [],
    imageUrl: typeof raw.imageUrl === 'string' && raw.imageUrl.startsWith('https://') ? raw.imageUrl : '',
    durationMs,
    startMs,
    endMs,
  };
}

function sanitizePlaylist(raw) {
  if (!isObject(raw) || !Array.isArray(raw.tracks)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  if (!name) return null;
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newId(),
    name,
    createdAt: isIsoDate(raw.createdAt) ? raw.createdAt : now,
    updatedAt: isIsoDate(raw.updatedAt) ? raw.updatedAt : now,
    tracks: raw.tracks.map(sanitizeTrack).filter(Boolean),
  };
}

/**
 * Parses and validates an export file (SPEC §4.4, E-3, E-4).
 * Playlists whose ID already exists get a new ID and the given suffix.
 * @returns {{ playlists: object[], trackCount: number }}
 */
export function parseImport(text, { existingIds = [], suffix = ' (imported)' } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('invalid');
  }
  if (!isObject(data) || data.app !== APP_ID || !Array.isArray(data.playlists)) throw new ImportError('invalid');
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) throw new ImportError('invalid');
  if (data.schemaVersion > SCHEMA_VERSION) throw new ImportError('newer');

  const taken = new Set(existingIds);
  const playlists = [];
  let trackCount = 0;
  for (const raw of data.playlists) {
    const playlist = sanitizePlaylist(raw);
    if (!playlist) continue;
    if (taken.has(playlist.id)) {
      playlist.id = newId();
      playlist.name = `${playlist.name}${suffix}`.slice(0, MAX_NAME_LENGTH + suffix.length);
    }
    taken.add(playlist.id);
    trackCount += playlist.tracks.length;
    playlists.push(playlist);
  }
  if (playlists.length === 0) throw new ImportError('empty');
  return { playlists, trackCount };
}

/* ---------- Reset (SPEC §4.5, S-5) ---------- */

/** Deletes every hockeydj.* key. */
export function resetAll() {
  try {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* Storage unavailable: nothing to reset. */
  }
}
