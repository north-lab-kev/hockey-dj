/**
 * spotify.js
 * The only module that talks to Spotify (SPEC §3, §6): Authorization Code with PKCE,
 * token refresh, and every Web API call. Errors are mapped to stable codes.
 */
import { getSettings, getAuth, setAuth, clearAuth, getPkce, setPkce, clearPkce } from './storage.js';

const ACCOUNTS_URL = 'https://accounts.spotify.com';
const API_URL = 'https://api.spotify.com/v1';

/** OAuth scopes required by the current phase (SPEC §3.2). */
export const SCOPES = ['user-read-playback-state', 'user-modify-playback-state'];

const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_LIFETIME_S = 3600;
const DEFAULT_RETRY_AFTER_S = 5;
const SEARCH_PAGE_SIZE = 10;
const MIN_IMAGE_WIDTH = 160;
const VERIFIER_LENGTH = 64;
const STATE_LENGTH = 16;
const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const TRACK_URI_PATTERN = /^spotify:track:([A-Za-z0-9]{22})$/;
const TRACK_URL_PATTERN = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})(?:[/?#].*)?$/i;

/** Error with a stable `code` the UI can translate (see SPEC §3.4, error handling). */
export class SpotifyError extends Error {
  constructor(code, { status = 0, detail = '', retryAfter = null } = {}) {
    super(detail || code);
    this.name = 'SpotifyError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

/** Returns true if the value looks like a Spotify Client ID. */
export function isValidClientId(value) {
  return CLIENT_ID_PATTERN.test(String(value || ''));
}

/** Redirect URI computed from the current location (SPEC §3.2). */
export function getRedirectUri() {
  let path = location.pathname.replace(/index\.html$/, '');
  if (!path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path)) path += '/';
  return location.origin + path;
}

/* ---------- Authorization (PKCE) ---------- */

function randomString(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let text = '';
  for (const byte of bytes) text += VERIFIER_CHARS[byte % VERIFIER_CHARS.length];
  return text;
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Starts the login: stores the PKCE values, then redirects to Spotify. */
export async function beginLogin() {
  const { clientId } = getSettings();
  if (!isValidClientId(clientId)) throw new SpotifyError('NO_CLIENT_ID');
  const verifier = randomString(VERIFIER_LENGTH);
  const state = randomString(STATE_LENGTH);
  const redirectUri = getRedirectUri();
  setPkce({ verifier, state, redirectUri });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
  });
  location.assign(`${ACCOUNTS_URL}/authorize?${params}`);
}

/** True when the current URL is Spotify's redirect back to the app. */
export function hasAuthCallback() {
  const params = new URLSearchParams(location.search);
  return params.has('state') && (params.has('code') || params.has('error'));
}

/** Finishes the login: checks `state`, exchanges the code for tokens and cleans the URL. */
export async function completeLogin() {
  const params = new URLSearchParams(location.search);
  const pkce = getPkce();
  clearPkce();
  history.replaceState(null, '', location.pathname + location.hash);

  const error = params.get('error');
  if (error) throw new SpotifyError(error === 'access_denied' ? 'ACCESS_DENIED' : 'AUTH_FAILED', { detail: error });
  if (!pkce || params.get('state') !== pkce.state) throw new SpotifyError('STATE_MISMATCH');

  const tokens = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.get('code') || '',
    redirect_uri: pkce.redirectUri,
    client_id: getSettings().clientId,
    code_verifier: pkce.verifier,
  }));
  storeTokens(tokens, null);
}

async function tokenRequest(body) {
  let response;
  try {
    response = await fetch(`${ACCOUNTS_URL}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    throw new SpotifyError('NETWORK');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = data?.error_description || data?.error || '';
    if (data?.error === 'invalid_grant') throw new SpotifyError('NOT_CONNECTED', { status: response.status, detail });
    if (data?.error === 'invalid_client') throw new SpotifyError('INVALID_CLIENT', { status: response.status, detail });
    throw new SpotifyError('AUTH_FAILED', { status: response.status, detail });
  }
  return data;
}

function storeTokens(tokens, previous) {
  setAuth({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || previous?.refreshToken || null,
    expiresAt: Date.now() + (Number(tokens.expires_in) || DEFAULT_TOKEN_LIFETIME_S) * 1000,
    scopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : previous?.scopes || [],
  });
}

/** True when tokens are stored. */
export function isConnected() {
  const auth = getAuth();
  return Boolean(auth?.accessToken && auth?.refreshToken);
}

/** True when the stored tokens grant every scope in SCOPES. */
export function hasRequiredScopes() {
  const granted = getAuth()?.scopes || [];
  return SCOPES.every((scope) => granted.includes(scope));
}

/** Deletes the tokens. The Client ID and playlists are kept. */
export function logout() {
  clearAuth();
}

let refreshing = null;

function refreshAccessToken() {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function doRefresh() {
  const auth = getAuth();
  const { clientId } = getSettings();
  if (!auth?.refreshToken || !clientId) throw new SpotifyError('NOT_CONNECTED');
  try {
    const tokens = await tokenRequest(new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: clientId,
    }));
    storeTokens(tokens, auth);
    return getAuth().accessToken;
  } catch (error) {
    if (error.code === 'NOT_CONNECTED' || error.code === 'INVALID_CLIENT') {
      clearAuth();
      throw new SpotifyError('NOT_CONNECTED', { detail: error.detail });
    }
    throw error;
  }
}

async function getAccessToken() {
  const auth = getAuth();
  if (!auth?.accessToken) throw new SpotifyError('NOT_CONNECTED');
  if (Date.now() < auth.expiresAt - REFRESH_MARGIN_MS) return auth.accessToken;
  return refreshAccessToken();
}

/* ---------- Web API ---------- */

function toError(response, data, path) {
  const status = response.status;
  const message = data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || '';
  const reason = data?.error?.reason || '';
  if (status === 401) return new SpotifyError('NOT_CONNECTED', { status, detail: message });
  if (status === 403) {
    if (reason === 'PREMIUM_REQUIRED' || /premium/i.test(message)) return new SpotifyError('PREMIUM_REQUIRED', { status, detail: message });
    if (/not registered|developer dashboard/i.test(message)) return new SpotifyError('USER_NOT_ALLOWED', { status, detail: message });
    if (/scope/i.test(message)) return new SpotifyError('MISSING_SCOPES', { status, detail: message });
    return new SpotifyError('FORBIDDEN', { status, detail: message });
  }
  if (status === 404) {
    if (reason === 'NO_ACTIVE_DEVICE' || path.startsWith('/me/player')) return new SpotifyError('NO_ACTIVE_DEVICE', { status, detail: message });
    return new SpotifyError('NOT_FOUND', { status, detail: message });
  }
  if (status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After')) || DEFAULT_RETRY_AFTER_S;
    const code = reason === 'QUOTA_EXCEEDED' ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED';
    return new SpotifyError(code, { status, detail: message, retryAfter });
  }
  return new SpotifyError('UNKNOWN', { status, detail: message });
}

async function request(method, path, { query, body, retry = true } = {}) {
  const token = await getAccessToken();
  const url = new URL(API_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  const init = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new SpotifyError('NETWORK');
  }
  if (response.status === 401 && retry) {
    await refreshAccessToken();
    return request(method, path, { query, body, retry: false });
  }
  const text = await response.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (response.ok) return data;
  throw toError(response, data, path);
}

function pickImage(images) {
  if (!Array.isArray(images)) return '';
  const sorted = images.filter((image) => image?.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  const image = sorted.find((candidate) => (candidate.width || 0) >= MIN_IMAGE_WIDTH) || sorted[sorted.length - 1];
  return image?.url || '';
}

function toTrack(item) {
  return {
    id: item.id,
    uri: item.uri || `spotify:track:${item.id}`,
    name: item.name || '',
    artists: (item.artists || []).map((artist) => artist?.name).filter(Boolean),
    imageUrl: pickImage(item.album?.images),
    durationMs: item.duration_ms || 0,
  };
}

/** Returns the current user's profile (`GET /me`). */
export function getProfile() {
  return request('GET', '/me');
}

/** Returns the available playback devices. */
export async function getDevices() {
  const data = await request('GET', '/me/player/devices');
  return Array.isArray(data?.devices) ? data.devices.filter((device) => device?.id) : [];
}

/** Returns the playback state, or null when nothing is loaded. */
export function getPlaybackState() {
  return request('GET', '/me/player');
}

/** Plays one track from the given position on the given device. */
export async function playTrack(uri, positionMs, deviceId) {
  await request('PUT', '/me/player/play', {
    query: { device_id: deviceId },
    body: { uris: [uri], position_ms: Math.max(0, Math.round(positionMs || 0)) },
  });
}

/** Pauses playback. Pausing a player that is already paused is not an error. */
export async function pause(deviceId) {
  try {
    await request('PUT', '/me/player/pause', { query: { device_id: deviceId } });
  } catch (error) {
    if (error.code === 'FORBIDDEN' || error.code === 'NO_ACTIVE_DEVICE') return;
    throw error;
  }
}

/** Makes the given device the active one, without starting playback. */
export async function transferPlayback(deviceId, play = false) {
  await request('PUT', '/me/player', { body: { device_ids: [deviceId], play } });
}

/** Searches tracks, 10 per page (SPEC §3.3). */
export async function searchTracks(query, offset = 0) {
  const data = await request('GET', '/search', {
    query: { q: query, type: 'track', limit: SEARCH_PAGE_SIZE, offset },
  });
  const page = data?.tracks;
  const items = (page?.items || []).filter((item) => item && TRACK_ID_PATTERN.test(item.id || '')).map(toTrack);
  return { items, hasMore: Boolean(page?.next) && items.length > 0 };
}

/** Returns one track by ID. */
export async function getTrack(id) {
  return toTrack(await request('GET', `/tracks/${encodeURIComponent(id)}`));
}

/** Extracts a track ID from a Spotify link or URI, or returns null (SPEC P-2). */
export function parseTrackInput(text) {
  const value = String(text || '').trim();
  const match = value.match(TRACK_URI_PATTERN) || value.match(TRACK_URL_PATTERN);
  return match ? match[1] : null;
}
