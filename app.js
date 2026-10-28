/**
 * app.js
 * Bootstrap, OAuth callback handling, view routing and app state (SPEC §6).
 * Implements the Play/Stop rules of SPEC §4.2.1 and the playback model of SPEC §3.4.
 */
import * as store from './storage.js';
import * as spotify from './spotify.js';
import { t, tn, has, setLanguage, resolveLanguage } from './i18n.js';
import * as ui from './ui.js';
import { APP_VERSION } from './version.js';

const SERVICE_WORKER_URL = 'sw.js'; // U-1
const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000; // U-2

const ADVANCE_AFTER_PLAYED_MS = 20_000; // R-2 (a), default of S-8
const ADVANCE_AFTER_IDLE_MS = 60_000; // R-2 (b), default of S-8
const ADVANCE_PLAYED_MIN_MS = 1_000; // S-8
const ADVANCE_PLAYED_MAX_MS = 300_000;
const ADVANCE_IDLE_MIN_MS = 5_000;
const ADVANCE_IDLE_MAX_MS = 600_000;
const ADVANCE_STEP_MS = 1_000;
const POLL_INTERVAL_MS = 5_000; // SPEC §3.4
const HANDOFF_LEAD_MS = 1_000; // R-5
const END_TOLERANCE_MS = 3_000; // SPEC §3.4 fallback
const LINK_WINDOW_MS = 12_000; // SPEC §3.4: a track link is learned only this soon after a start
const LINK_TOLERANCE_MS = 2_500; // SPEC §3.4: how closely Spotify's progress must follow ours
const POLL_GRACE_MS = 2_500;
const TICK_MS = 250;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_TAIL_MS = 1_000; // P-7, P-10: a start must stay at least this long before the end
const START_STEP_MS = 100;
const THEME_COLORS = { light: '#EEF3F7', dark: '#0B1424' };
const KEY_BUTTONS = ['1', '2', '3', '4']; // G-8: keys of game buttons 1 to 4

const ADVANCE_SETTINGS = Object.freeze({
  played: { key: 'advanceAfterPlayedMs', defaultMs: ADVANCE_AFTER_PLAYED_MS, minMs: ADVANCE_PLAYED_MIN_MS, maxMs: ADVANCE_PLAYED_MAX_MS },
  idle: { key: 'advanceAfterIdleMs', defaultMs: ADVANCE_AFTER_IDLE_MS, minMs: ADVANCE_IDLE_MIN_MS, maxMs: ADVANCE_IDLE_MAX_MS },
});

const root = document.getElementById('app');

function idlePlayback() {
  return {
    status: 'stopped',
    mode: null,
    playlistId: null,
    busy: false,
    index: 0,
    uri: null,
    durationMs: 0,
    endMs: null,
    positionMs: 0,
    syncedAt: 0,
    segmentStartedAt: 0,
    ignorePollUntil: 0,
    previewKey: null,
  };
}

function emptySearch() {
  return { query: '', results: [], loading: false, error: '', hasMore: false, offset: 0, done: false };
}

const state = {
  view: 'setup',
  connected: false,
  justConnected: false,
  notice: '',
  profile: null,
  settings: store.getSettings(),
  playlists: store.getPlaylists(),
  games: store.getGames(),
  trackLinks: store.getTrackLinks(),
  devices: [],
  devicesLoading: false,
  devicesLoaded: false,
  redirectUri: spotify.getRedirectUri(),
  editingPlaylistId: null,
  expandedTrack: null,
  search: emptySearch(),
  spotifyImporting: false,
  playback: idlePlayback(),
  browser: { support: spotify.browserPlaybackSupport(), status: 'off', id: null, error: '', failure: null },
  appVersion: APP_VERSION,
  updateVersion: null,
};

const actions = {
  navigate,
  setLanguage: setLanguagePreference,
  setTheme: setThemePreference,
  advanceValue,
  setAdvance,
  nudgeAdvance,
  resetAdvance,
  setShuffle,
  saveClientId,
  connect,
  disconnect: confirmDisconnect,
  copy,
  continueSetup,
  refreshDevices: () => refreshDevices(),
  selectDevice,
  openDevicePicker,
  pressButton,
  prev: (playlistId) => step(playlistId, -1),
  next: (playlistId) => step(playlistId, 1),
  describeGroups,
  playingPlaylistId,
  assignButton,
  previewPosition: () => estimateProgress(),
  createPlaylist,
  openPlaylist,
  closePlaylist,
  renamePlaylist,
  duplicatePlaylist,
  deletePlaylist,
  exportPlaylist,
  exportAll,
  importFile,
  searchInput,
  searchNow: () => runSearch(false),
  searchMore: () => runSearch(true),
  addTrack,
  importSpotifyPlaylist,
  toggleTrack,
  previewToggle,
  markHere,
  setStart,
  setEnd,
  clearEnd,
  clearStart,
  moveTrack,
  removeTrack,
  resetAll: confirmReset,
  reloadApp: () => location.reload(),
};

/* ---------- Helpers ---------- */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wrap(index, length) {
  return ((index % length) + length) % length;
}

function maxStart(track) {
  return Math.max(0, (track?.durationMs || 0) - MIN_TAIL_MS);
}

/** Where a track stops: its marked end, or the end of the song (P-10). */
function endOf(track) {
  return track?.endMs ?? track?.durationMs ?? 0;
}

/** The latest position a track can resume from (R-3, P-10). */
function maxPosition(track) {
  return Math.max(0, endOf(track) - MIN_TAIL_MS);
}

/** Where the track that is playing stops: its marked end, or the end of the song. */
function playbackEnd(playback) {
  return playback.endMs ?? playback.durationMs;
}

function findPlaylist(id) {
  return state.playlists.find((playlist) => playlist.id === id) || null;
}

function isGamePlaying() {
  return state.playback.mode === 'game' && state.playback.status === 'playing';
}

function isPreviewing() {
  return state.playback.mode === 'preview' && state.playback.status === 'playing';
}

/** The playlist whose game music plays, or is starting or stopping, or null (G-2). */
function playingPlaylistId() {
  const playback = state.playback;
  return playback.mode === 'game' && (playback.status === 'playing' || playback.busy) ? playback.playlistId : null;
}

function trackIdOf(uri) {
  return String(uri || '').split(':').pop();
}

/**
 * True when a playback item is the track with this URI, or the copy of it that Spotify
 * plays instead (track relinking, SPEC §3.4). Only IDs are compared, never names.
 */
function isOurTrack(item, uri) {
  if (!item?.uri) return false;
  return item.uri === uri || (Boolean(item.id) && item.id === state.trackLinks[trackIdOf(uri)]);
}

/**
 * Learns that Spotify plays another copy of our track (SPEC §3.4): soon after a start, a
 * playing item with another ID whose progress follows ours is that copy. Returns true when learned.
 */
function learnTrackLink(playback, remote, now) {
  const soon = now - playback.segmentStartedAt <= LINK_WINDOW_MS;
  const inStep = Math.abs(remote.progress_ms - estimateProgress(now)) <= LINK_TOLERANCE_MS;
  if (!soon || !inStep || !remote.item?.id) return false;
  state.trackLinks = store.setTrackLink(trackIdOf(playback.uri), remote.item.id);
  return isOurTrack(remote.item, playback.uri);
}

/** Estimated position of the track that is playing now, in milliseconds. */
function estimateProgress(now = Date.now(), playback = state.playback) {
  if (playback.status !== 'playing' || playback.busy) return playback.positionMs;
  const position = playback.positionMs + (now - playback.syncedAt);
  return playback.durationMs ? Math.min(position, playback.durationMs) : position;
}

function savePlaylists() {
  if (!store.savePlaylists(state.playlists)) ui.toast(t('errors.STORAGE'), 'error');
  syncGames();
}

function touch(playlist) {
  playlist.updatedAt = new Date().toISOString();
}

/* ---------- Rendering ---------- */

let lastGameKey = '';

/** Changes when a group needs more than its live parts updated (status, track or busy state). */
function gameKey() {
  const groups = describeGroups().map((group) => (group.empty
    ? `${group.playlist.id}:empty`
    : `${group.playlist.id}:${group.status}:${group.index}:${group.busy}:${group.thenTrack.id}`));
  return groups.join('|');
}

function render() {
  ui.renderApp(root, state, actions);
  lastGameKey = gameKey();
  updateWakeLock();
}

function tick() {
  if (isPreviewing() && !state.playback.busy && estimateProgress() >= playbackEnd(state.playback)) {
    stopPreview();
    render();
    return;
  }
  if (state.view === 'game') {
    if (gameKey() !== lastGameKey) render();
    else ui.updateLive(root, describeGroups());
  } else if (state.view === 'playlists' && isPreviewing()) {
    ui.updatePreviewTime(root, estimateProgress());
  }
}

/* ---------- Language and theme (SPEC §4.6, S-7) ---------- */

function applyLanguage() {
  setLanguage(resolveLanguage(state.settings.language));
}

function setLanguagePreference(language) {
  state.settings = store.updateSettings({ language });
  applyLanguage();
  render();
}

function applyTheme() {
  const theme = state.settings.theme === 'light' || state.settings.theme === 'dark' ? state.settings.theme : null;
  const element = document.documentElement;
  if (theme) element.dataset.theme = theme;
  else delete element.dataset.theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const scheme = (meta.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', THEME_COLORS[theme || scheme]);
  });
}

function setThemePreference(theme) {
  state.settings = store.updateSettings({ theme });
  applyTheme();
  render();
}

/* ---------- Navigation ---------- */

function navigate(view) {
  if (!state.connected && view !== 'setup') return;
  if (view !== 'playlists' || state.editingPlaylistId) stopPreview();
  state.view = view;
  state.justConnected = false;
  state.editingPlaylistId = null;
  state.expandedTrack = null;
  state.search = emptySearch();
  render();
  window.scrollTo(0, 0);
}

function continueSetup() {
  state.notice = '';
  navigate(state.playlists.length ? 'game' : 'playlists');
}

/* ---------- Errors ---------- */

function errorMessage(error) {
  const code = error?.code || 'UNKNOWN';
  const key = has(`errors.${code}`) ? `errors.${code}` : 'errors.UNKNOWN';
  return t(key, { seconds: error?.retryAfter ?? 5, detail: error?.detail || '' }).trim();
}

/** Disconnects from Spotify and forgets the browser player. */
function logoutSpotify() {
  spotify.logout();
  state.browser = { ...state.browser, status: 'off', id: null, error: '', failure: null };
}

function markDisconnected() {
  stopLoops();
  logoutSpotify();
  state.connected = false;
  state.profile = null;
  state.playback = idlePlayback();
  state.notice = t('errors.NOT_CONNECTED');
  state.view = 'setup';
  render();
}

function handleError(error) {
  const code = error?.code || 'UNKNOWN';
  if (code === 'NOT_CONNECTED') {
    markDisconnected();
    return;
  }
  if (code === 'NO_DEVICE_SELECTED') {
    ui.toast(t('errors.NO_DEVICE_SELECTED'));
    return;
  }
  if (!(error instanceof spotify.SpotifyError)) console.error(error);
  ui.toast(errorMessage(error), 'error');
}

/* ---------- Spotify connection (SPEC §3.2, §4.1) ---------- */

function saveClientId(value) {
  const clientId = String(value || '').trim();
  if (!spotify.isValidClientId(clientId)) {
    ui.toast(t('setup.toast.invalidClientId'), 'error');
    return;
  }
  const changed = clientId !== state.settings.clientId;
  state.settings = store.updateSettings({ clientId });
  if (changed && state.connected) {
    stopLoops();
    logoutSpotify();
    state.connected = false;
    state.profile = null;
    state.view = 'setup';
  }
  ui.toast(t('setup.toast.clientIdSaved'), 'success');
  render();
}

async function connect() {
  try {
    await spotify.beginLogin();
  } catch (error) {
    handleError(error);
  }
}

async function confirmDisconnect() {
  const confirmed = await ui.confirmDialog({
    title: t('settings.disconnectTitle'),
    message: t('settings.disconnectBody'),
    confirmLabel: t('settings.disconnect'),
    danger: true,
  });
  if (!confirmed) return;
  stopLoops();
  stopPreview();
  logoutSpotify();
  state.connected = false;
  state.profile = null;
  state.devices = [];
  state.devicesLoaded = false;
  state.playback = idlePlayback();
  state.notice = '';
  state.view = 'setup';
  render();
  ui.toast(t('settings.toast.disconnected'));
}

async function loadProfile() {
  try {
    const profile = await spotify.getProfile();
    state.profile = { name: profile?.display_name || profile?.id || '' };
    render();
  } catch (error) {
    handleError(error);
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    ui.toast(t('common.copied'), 'success');
  } catch {
    ui.toast(t('common.copyFailed'), 'error');
  }
}

/* ---------- Devices (SPEC §3.4) ---------- */

async function refreshDevices({ silent = false } = {}) {
  state.devicesLoading = true;
  ui.refreshDevicePickers(state, actions);
  try {
    state.devices = await spotify.getDevices();
    state.devicesLoaded = true;
  } catch (error) {
    if (!silent) handleError(error);
  } finally {
    state.devicesLoading = false;
  }
  render();
  ui.refreshDevicePickers(state, actions);
  return state.devices;
}

function selectDevice(id) {
  state.settings = store.updateSettings({ deviceId: id });
  render();
  ui.refreshDevicePickers(state, actions);
}

function openDevicePicker() {
  ui.openDevicePicker(state, actions);
  refreshDevices({ silent: true });
}

/* ---------- Browser player (SPEC §3.4, B-1 to B-5) ---------- */

function setBrowser(patch) {
  state.browser = { ...state.browser, ...patch };
  render();
  ui.refreshDevicePickers(state, actions);
}

/** Connects this browser as a Spotify device when it can play (B-1). */
async function startBrowserPlayback() {
  if (!state.browser.support || state.browser.status !== 'off') return;
  setBrowser({ status: 'loading', error: '', failure: null });
  try {
    await spotify.startBrowserPlayer({
      onReady: (id) => {
        setBrowser({ status: 'ready', id, error: '' });
        if (!state.settings.deviceId && state.browser.support === 'desktop') selectDevice(store.BROWSER_DEVICE_ID);
      },
      onNotReady: () => setBrowser({ status: 'offline' }),
      onError: (error) => {
        if (error.code === 'BROWSER_PLAYBACK') handleError(error);
        else setBrowser({ status: 'error', error: errorMessage(error), failure: error });
      },
    });
  } catch (error) {
    setBrowser({ status: 'error', error: errorMessage(error), failure: error });
  }
}

/** Maps a saved device ID to a Spotify device ID: the browser sentinel becomes the live player ID (B-3). */
function resolveDeviceId(id) {
  if (id !== store.BROWSER_DEVICE_ID) return id;
  if (state.browser.status === 'ready') return state.browser.id;
  throw (state.browser.status === 'error' && state.browser.failure) || new spotify.SpotifyError('BROWSER_NOT_READY');
}

/** The device to pause, or null to let Spotify pause the active one. */
function pauseDeviceId() {
  try {
    return resolveDeviceId(state.settings.deviceId);
  } catch {
    return null;
  }
}

/** Unlocks the browser player's audio during a tap, when it is (or will be) the playback device (B-4). */
function unlockBrowserAudio() {
  const selected = state.settings.deviceId;
  if (selected === store.BROWSER_DEVICE_ID || (!selected && state.browser.status === 'ready')) spotify.activateBrowserPlayer();
}

/** Returns the device to play on, picking one automatically when there is no doubt. */
async function ensureDevice() {
  if (state.settings.deviceId) {
    try {
      return resolveDeviceId(state.settings.deviceId);
    } catch (error) {
      openDevicePicker();
      throw error;
    }
  }
  if (state.browser.support === 'desktop' && state.browser.status === 'ready') {
    selectDevice(store.BROWSER_DEVICE_ID);
    return state.browser.id;
  }
  const devices = (await refreshDevices({ silent: true }))
    .filter((device) => !device.is_restricted && device.id !== state.browser.id);
  const pick = devices.find((device) => device.is_active) || (devices.length === 1 ? devices[0] : null);
  if (pick) {
    selectDevice(pick.id);
    return pick.id;
  }
  openDevicePicker();
  throw new spotify.SpotifyError('NO_DEVICE_SELECTED');
}

/** Plays a track, activating the saved device first when Spotify reports none is active. */
async function playOnDevice(uri, positionMs, deviceId) {
  try {
    await spotify.playTrack(uri, positionMs, deviceId);
    return;
  } catch (error) {
    if (error.code !== 'NO_ACTIVE_DEVICE') throw error;
  }
  const devices = await refreshDevices({ silent: true });
  const device = devices.find((candidate) => candidate.id === deviceId && !candidate.is_restricted);
  if (!device) {
    openDevicePicker();
    throw new spotify.SpotifyError('DEVICE_UNAVAILABLE');
  }
  await spotify.transferPlayback(deviceId, false);
  await spotify.playTrack(uri, positionMs, deviceId);
}

/* ---------- Game rules (SPEC §4.2.1) ---------- */

/** Returns the R-2 threshold in effect for "played" or "idle", with its default and limits (S-8). */
function advanceValue(which) {
  const { key, defaultMs, minMs, maxMs } = ADVANCE_SETTINGS[which];
  const stored = state.settings[key];
  const valid = Number.isFinite(stored) && stored >= minMs && stored <= maxMs;
  return { ms: valid ? stored : defaultMs, defaultMs, minMs, maxMs };
}

function shouldAdvance(game, now) {
  if (!game.stoppedAt) return false;
  const idleMs = now - Date.parse(game.stoppedAt);
  return game.playedMs >= advanceValue('played').ms || idleMs > advanceValue('idle').ms;
}

function setAdvanceMs(which, value) {
  const { minMs, maxMs } = ADVANCE_SETTINGS[which];
  const rounded = Math.round(value / ADVANCE_STEP_MS) * ADVANCE_STEP_MS;
  const clamped = clamp(rounded, minMs, maxMs);
  if (clamped !== rounded) {
    ui.toast(t('settings.toast.advanceClamped', {
      min: ui.formatTime(minMs), max: ui.formatTime(maxMs), time: ui.formatTime(clamped),
    }), 'error');
  }
  state.settings = store.updateSettings({ [ADVANCE_SETTINGS[which].key]: clamped });
  render();
}

/** Saves an R-2 threshold typed as m:ss or seconds (S-8). */
function setAdvance(which, text) {
  const value = ui.parseTime(text);
  if (value == null) {
    ui.toast(t('settings.toast.invalidTime'), 'error');
    render();
    return;
  }
  setAdvanceMs(which, value);
}

/** Moves an R-2 threshold by deltaMs (S-8). */
function nudgeAdvance(which, deltaMs) {
  setAdvanceMs(which, advanceValue(which).ms + deltaMs);
}

/** Restores both R-2 thresholds to their defaults (S-8). */
function resetAdvance() {
  state.settings = store.updateSettings({ advanceAfterPlayedMs: null, advanceAfterIdleMs: null });
  render();
}

/* ---------- Shuffle (SPEC §4.2.2) ---------- */

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomInt(0, index);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Keeps a new pass from starting with the song that ended the previous one (R-12). */
function avoidRepeat(pass, lastId) {
  if (pass.length > 1 && pass[0] === lastId) {
    const other = randomInt(1, pass.length - 1);
    [pass[0], pass[other]] = [pass[other], pass[0]];
  }
  return pass;
}

/** Drops unknown or duplicate IDs, then inserts the missing ones at random positions from `insertFrom` (R-14). */
function repairPass(pass, ids, insertFrom) {
  const known = new Set(ids);
  const kept = [...new Set(pass.filter((id) => known.has(id)))];
  const from = Math.min(insertFrom(kept), kept.length);
  ids.filter((id) => !kept.includes(id)).forEach((id) => kept.splice(randomInt(from, kept.length), 0, id));
  return kept;
}

function isPass(value) {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

function samePass(pass, ids) {
  return isPass(pass) && pass.length === ids.length && ids.every((id) => pass.includes(id));
}

/** Makes saved passes match the playlist's songs. New songs go after `currentId` in the current pass (R-14). */
function repairPasses(shuffle, ids, currentId) {
  const order = repairPass(shuffle.order, ids, (kept) => kept.indexOf(currentId) + 1);
  const upcoming = isPass(shuffle.upcoming) ? repairPass(shuffle.upcoming, ids, () => 1) : shuffled(ids);
  return {
    past: samePass(shuffle.past, ids) ? shuffle.past : null,
    order,
    upcoming: avoidRepeat(upcoming, order[order.length - 1]),
  };
}

/**
 * Returns a playlist's game state with valid shuffle passes, or `shuffle: null` when shuffle is off (R-11 to R-14),
 * and with its prepared track dropped when that song left the playlist (R-15).
 * A new game starts on a random track, unless `keepCurrent` is set.
 */
function withShuffle(game, playlist, { keepCurrent = false } = {}) {
  const tracks = playlist.tracks;
  const ids = tracks.map((track) => track.id);
  const prepared = game.prepared && ids.includes(game.prepared.trackId) ? game.prepared : null;
  if (!state.settings.shuffle || !tracks.length) {
    return { ...game, shuffle: null, prepared: prepared && { trackId: prepared.trackId, shuffle: null } };
  }
  const preparedShuffle = isPass(prepared?.shuffle?.order) ? repairPasses(prepared.shuffle, ids, prepared.trackId) : null;
  const keptPrepared = prepared && { trackId: prepared.trackId, shuffle: preparedShuffle };
  const index = wrap(game.currentIndex, tracks.length);
  const current = game.shuffle;
  if (!current || !isPass(current.order)) {
    const fresh = !keepCurrent && playingPlaylistId() !== playlist.id
      && !game.stoppedAt && !game.playedMs && game.positionMs == null;
    const order = fresh ? shuffled(ids) : [ids[index], ...shuffled(ids.filter((id) => id !== ids[index]))];
    return {
      ...game,
      currentIndex: fresh ? ids.indexOf(order[0]) : index,
      shuffle: { past: null, order, upcoming: avoidRepeat(shuffled(ids), order[order.length - 1]) },
      prepared: keptPrepared,
    };
  }
  return { ...game, shuffle: repairPasses(current, ids, ids[index]), prepared: keptPrepared };
}

/**
 * Where a move of `delta` (+1 or -1) from the track at `index` lands (R-6, R-7, R-12).
 * Returns the playlist index and the shuffle passes after the move. A new pass gets
 * its own `upcoming` pass when the game state is saved.
 */
function moveFrom(playlist, index, delta, shuffle) {
  const tracks = playlist.tracks;
  if (!shuffle) return { index: wrap(index + delta, tracks.length), shuffle: null };
  const indexOf = (id) => Math.max(0, tracks.findIndex((track) => track.id === id));
  const { past, order } = shuffle;
  const upcoming = shuffle.upcoming || order;
  const target = order.indexOf(tracks[index]?.id) + delta;
  if (target >= order.length) return { index: indexOf(upcoming[0]), shuffle: { past: order, order: upcoming, upcoming: null } };
  if (target < 0 && past) return { index: indexOf(past[past.length - 1]), shuffle: { past: null, order: past, upcoming: order } };
  return { index: indexOf(order[wrap(target, order.length)]), shuffle };
}

/** Turns shuffle on or off for every playlist (S-9). Each current track stays where it is. */
function setShuffle(enabled) {
  state.settings = store.updateSettings({ shuffle: enabled });
  for (const playlist of state.playlists) {
    const game = state.games[playlist.id];
    if (!game) continue;
    const prepared = game.prepared && { trackId: game.prepared.trackId, shuffle: null };
    saveGame(playlist, { ...game, shuffle: null, prepared }, { keepCurrent: true });
  }
  render();
}

/* ---------- Game buttons (SPEC §4.2, G-10, P-11) ---------- */

/** The playlists that have a game button, in button order (G-10). */
function groupPlaylists() {
  return state.settings.buttons
    .map((id, slot) => ({ slot, playlist: findPlaylist(id) }))
    .filter((entry) => entry.playlist);
}

function hasButton(playlistId) {
  return state.settings.buttons.includes(playlistId);
}

/** The playlist of the last-used group (G-8): the one that plays, the last one used, or the first group. */
function lastGroupPlaylist() {
  const playingId = playingPlaylistId();
  if (playingId) return findPlaylist(playingId);
  const groups = groupPlaylists();
  return (groups.find((entry) => entry.playlist.id === state.settings.activePlaylistId) || groups[0])?.playlist || null;
}

function markUsed(playlistId) {
  if (state.settings.activePlaylistId !== playlistId) state.settings = store.updateSettings({ activePlaylistId: playlistId });
}

/** Frees the buttons of playlists that no longer exist. */
function ensureButtons() {
  const buttons = state.settings.buttons.map((id) => (findPlaylist(id) ? id : null));
  if (buttons.some((id, slot) => id !== state.settings.buttons[slot])) state.settings = store.updateSettings({ buttons });
}

/**
 * Gives a playlist a game button (slot 0 to 4), or none (null). A button that another
 * playlist holds is taken from it. The playlist that plays keeps its button (P-11).
 */
function assignButton(playlistId, slot) {
  const playlist = findPlaylist(playlistId);
  if (!playlist) return;
  const playingId = playingPlaylistId();
  const holder = slot == null ? null : state.settings.buttons[slot];
  if (holder === playlistId) return;
  if (playingId && (playingId === playlistId || playingId === holder)) {
    ui.toast(t('editor.toast.buttonPlaying'), 'error');
    return;
  }
  const buttons = state.settings.buttons.map((id) => (id === playlistId ? null : id));
  if (slot != null) buttons[slot] = playlistId;
  state.settings = store.updateSettings({ buttons });
  syncGames();
  render();
}

/* ---------- Game state (SPEC §4.2.1, R-10) ---------- */

/** The saved game state of a playlist. */
function gameOf(playlist) {
  return state.games[playlist.id] || store.defaultGame();
}

/** Saves a playlist's game state, after making its shuffle passes match its songs (R-11 to R-15). */
function saveGame(playlist, game, options) {
  state.games = { ...state.games, [playlist.id]: withShuffle(game, playlist, options) };
  store.setGames(state.games);
}

/**
 * Repairs the game state of every playlist that has one or has a button, so that its
 * order is stable, and drops the states of deleted playlists (R-10, R-14).
 */
function syncGames() {
  const games = {};
  for (const playlist of state.playlists) {
    const game = state.games[playlist.id];
    if (game || hasButton(playlist.id)) games[playlist.id] = withShuffle(game || store.defaultGame(), playlist);
  }
  state.games = games;
  store.setGames(games);
}

function preparedIndex(playlist, game) {
  return game.prepared ? playlist.tracks.findIndex((track) => track.id === game.prepared.trackId) : -1;
}

/** The track after the one at `index`: the prepared track (R-15), or the next one (R-5, R-6, R-12). */
function followingTrack(playlist, index, game = gameOf(playlist)) {
  const prepared = preparedIndex(playlist, game);
  if (prepared >= 0) return { index: prepared, shuffle: game.prepared.shuffle };
  return moveFrom(playlist, index, 1, game.shuffle);
}

/** What the next Play of a playlist will do (R-2, R-3, R-9, R-15). */
function planPlay(playlist, now = Date.now()) {
  const tracks = playlist.tracks;
  const game = gameOf(playlist);
  const prepared = preparedIndex(playlist, game);
  if (prepared >= 0) {
    return { index: prepared, positionMs: tracks[prepared].startMs, status: 'next', shuffle: game.prepared.shuffle };
  }
  const index = wrap(game.currentIndex, tracks.length);
  if (shouldAdvance(game, now)) {
    const next = moveFrom(playlist, index, 1, game.shuffle);
    return { index: next.index, positionMs: tracks[next.index].startMs, status: 'next', shuffle: next.shuffle };
  }
  const track = tracks[index];
  const positionMs = clamp(game.positionMs ?? track.startMs, 0, maxPosition(track));
  return { index, positionMs, status: game.stoppedAt ? 'resume' : 'start', shuffle: game.shuffle };
}

/**
 * Describes one group of the Game screen (G-4): the track its button plays or will play,
 * and the track that follows it.
 */
function describeGroup(playlist, now = Date.now()) {
  const playback = state.playback;
  const own = playback.mode === 'game' && playback.playlistId === playlist.id;
  const base = { playlist, busy: own && playback.busy };
  if (!playlist.tracks.length) return { ...base, empty: true, playing: false };
  const tracks = playlist.tracks;
  const playing = own && playback.status === 'playing';
  const plan = playing
    ? { index: wrap(playback.index, tracks.length), positionMs: estimateProgress(now), status: 'playing', shuffle: gameOf(playlist).shuffle }
    : planPlay(playlist, now);
  const then = playing ? followingTrack(playlist, plan.index) : moveFrom(playlist, plan.index, 1, plan.shuffle);
  return {
    ...base,
    empty: false,
    playing,
    index: plan.index,
    status: plan.status,
    positionMs: plan.positionMs,
    durationMs: playing ? playbackEnd(playback) : endOf(tracks[plan.index]),
    shuffle: plan.shuffle,
    track: tracks[plan.index],
    thenTrack: tracks[then.index],
  };
}

/** Describes every group of the Game screen, in button order. */
function describeGroups(now = Date.now()) {
  return groupPlaylists().map(({ slot, playlist }) => ({ slot, ...describeGroup(playlist, now) }));
}

/* ---------- Play and Stop (SPEC §4.2.1, G-2, G-6) ---------- */

/** A tap on a game button: Stop when its playlist plays, otherwise Play, switching from the playlist that plays (G-6). */
async function pressButton(playlistId) {
  if (state.playback.busy) return;
  const playlist = findPlaylist(playlistId);
  if (!playlist) return;
  markUsed(playlistId);
  if (isGamePlaying() && state.playback.playlistId === playlistId) {
    await stopGame();
    return;
  }
  if (!playlist.tracks.length) {
    ui.toast(t('game.toast.empty'), 'error');
    render();
    return;
  }
  unlockBrowserAudio();
  const previous = isGamePlaying() ? state.playback : null;
  if (state.playback.mode === 'preview') state.playback = idlePlayback();
  const plan = planPlay(playlist);
  await startGameTrack(playlist, plan.index, plan.positionMs, { resetPlayed: plan.status === 'next', shuffle: plan.shuffle, previous });
}

/** Where the game track that is playing stops, and how long it played since its last start (R-1). */
function stopValues(playback, now) {
  return {
    positionMs: clamp(estimateProgress(now, playback), 0, Math.max(0, playbackEnd(playback) - MIN_TAIL_MS)),
    segmentMs: Math.max(0, now - playback.segmentStartedAt),
  };
}

/** Saves a Stop in a playlist's game state (R-1). */
function saveStop(playlist, { positionMs, segmentMs }, now) {
  const game = gameOf(playlist);
  saveGame(playlist, { ...game, positionMs, playedMs: game.playedMs + segmentMs, stoppedAt: new Date(now).toISOString() });
}

/**
 * Starts a track of a playlist. Returns true on success.
 * `previous` is the playback of another playlist that this start replaces (G-6): it is
 * saved as a Stop right away, and keeps playing if the start fails.
 */
async function startGameTrack(playlist, index, positionMs, { resetPlayed, shuffle = gameOf(playlist).shuffle, previous = null }) {
  const track = playlist.tracks[index];
  const switchedAt = Date.now();
  const left = previous && findPlaylist(previous.playlistId);
  const leftBefore = left && gameOf(left);
  stopLoops();
  // The playlist left behind shows where it stopped while the play request runs (G-3).
  if (left) saveStop(left, stopValues(previous, switchedAt), switchedAt);
  state.playback = {
    ...idlePlayback(),
    status: 'playing',
    mode: 'game',
    busy: true,
    playlistId: playlist.id,
    index,
    uri: track.uri,
    durationMs: track.durationMs,
    endMs: track.endMs ?? null,
    positionMs,
  };
  render();
  try {
    const deviceId = await ensureDevice();
    await playOnDevice(track.uri, positionMs, deviceId);
  } catch (error) {
    if (left) saveGame(left, leftBefore);
    state.playback = previous || idlePlayback();
    if (previous) startLoops();
    render();
    handleError(error);
    return false;
  }
  const now = Date.now();
  state.playback = { ...state.playback, busy: false, syncedAt: now, segmentStartedAt: now, ignorePollUntil: now + POLL_GRACE_MS };
  const game = gameOf(playlist);
  const sameTrack = index === game.currentIndex && !resetPlayed;
  saveGame(playlist, { currentIndex: index, positionMs, playedMs: sameTrack ? game.playedMs : 0, stoppedAt: null, shuffle, prepared: null });
  startLoops();
  render();
  return true;
}

/** Stop (R-1). `external` means playback was already paused from Spotify. */
async function stopGame({ external = false } = {}) {
  const playback = state.playback;
  const playlist = findPlaylist(playback.playlistId);
  const now = Date.now();
  const before = playlist && gameOf(playlist);
  stopLoops();
  // Saved before the pause request, so the group shows where it stopped while the request runs (G-3).
  if (playlist) saveStop(playlist, stopValues(playback, now), now);
  if (!external) {
    state.playback = { ...playback, status: 'stopped', busy: true };
    render();
    try {
      await spotify.pause(pauseDeviceId());
    } catch (error) {
      if (playlist) saveGame(playlist, before);
      state.playback = playback;
      startLoops();
      render();
      handleError(error);
      return;
    }
  }
  state.playback = idlePlayback();
  render();
}

/** End of track (R-5): play the prepared track, or the next one, at its start. */
async function continueToNext() {
  if (!isGamePlaying() || state.playback.busy) return;
  const playlist = findPlaylist(state.playback.playlistId);
  if (!playlist?.tracks.length) return;
  const { index: next, shuffle } = followingTrack(playlist, state.playback.index);
  const started = await startGameTrack(playlist, next, playlist.tracks[next].startMs, { resetPlayed: true, shuffle });
  if (!started) {
    saveGame(playlist, { currentIndex: next, positionMs: null, playedMs: 0, stoppedAt: null, shuffle, prepared: null });
    render();
  }
}

/**
 * Previous or Next of a group (R-7, R-13, R-15). While its playlist plays, it moves the
 * prepared track and the current one keeps playing. Otherwise it selects the track the next Play starts.
 */
function step(playlistId, delta) {
  if (state.playback.busy) return;
  const playlist = findPlaylist(playlistId);
  if (!playlist?.tracks.length) return;
  markUsed(playlistId);
  const group = describeGroup(playlist);
  const game = gameOf(playlist);
  if (group.playing) {
    const following = followingTrack(playlist, group.index, game);
    const move = moveFrom(playlist, following.index, delta, following.shuffle);
    saveGame(playlist, { ...game, prepared: { trackId: playlist.tracks[move.index].id, shuffle: move.shuffle } });
  } else {
    const move = moveFrom(playlist, group.index, delta, group.shuffle);
    saveGame(playlist, { ...game, currentIndex: move.index, positionMs: null, playedMs: 0, stoppedAt: null, shuffle: move.shuffle, prepared: null });
  }
  render();
}

/* ---------- Playback loops (SPEC §3.4) ---------- */

let pollTimer = null;
let handoffTimer = null;

function stopLoops() {
  clearTimeout(pollTimer);
  clearTimeout(handoffTimer);
  pollTimer = null;
  handoffTimer = null;
}

function startLoops() {
  schedulePoll();
  scheduleHandoff();
}

function schedulePoll(delay = POLL_INTERVAL_MS) {
  clearTimeout(pollTimer);
  if (isGamePlaying()) pollTimer = setTimeout(pollPlayback, delay);
}

function scheduleHandoff() {
  clearTimeout(handoffTimer);
  if (!isGamePlaying()) return;
  // A marked end cuts exactly there; a natural end hands off a little early (R-5, P-10).
  const lead = state.playback.endMs != null ? 0 : HANDOFF_LEAD_MS;
  const remaining = playbackEnd(state.playback) - estimateProgress();
  handoffTimer = setTimeout(continueToNext, Math.max(0, remaining - lead));
}

async function pollPlayback() {
  const playback = state.playback;
  if (!isGamePlaying() || document.hidden) return;
  if (playback.busy || Date.now() < playback.ignorePollUntil) {
    schedulePoll();
    return;
  }
  let remote;
  try {
    remote = await spotify.getPlaybackState();
  } catch (error) {
    if (error.code === 'NOT_CONNECTED') {
      handleError(error);
      return;
    }
    const retryMs = error.retryAfter ? error.retryAfter * 1000 : POLL_INTERVAL_MS;
    schedulePoll(Math.max(POLL_INTERVAL_MS, retryMs));
    return;
  }
  if (state.playback !== playback || !isGamePlaying() || playback.busy) return;

  const now = Date.now();
  let sameTrack = isOurTrack(remote?.item, playback.uri);
  if (!sameTrack && remote?.is_playing && learnTrackLink(playback, remote, now)) sameTrack = true;
  if (sameTrack && remote.is_playing) {
    playback.positionMs = remote.progress_ms ?? playback.positionMs;
    playback.syncedAt = now;
    if (remote.item.duration_ms) playback.durationMs = remote.item.duration_ms;
    scheduleHandoff();
    schedulePoll();
    return;
  }
  const nearEnd = playbackEnd(playback) - estimateProgress(now) <= END_TOLERANCE_MS
    || (sameTrack && remote.progress_ms >= playbackEnd(playback) - END_TOLERANCE_MS);
  if (nearEnd || (remote?.is_playing && !sameTrack)) {
    // Our track ended, or something else (for example Spotify Autoplay) took over.
    continueToNext();
    return;
  }
  // Paused from the Spotify app in the middle of the track: same as Stop (R-1).
  if (sameTrack && Number.isFinite(remote.progress_ms)) {
    playback.positionMs = remote.progress_ms;
    playback.syncedAt = now;
  }
  stopGame({ external: true });
}

/** After a reload, picks up a track that is still playing (R-10). */
async function restorePlayback() {
  const playlist = findPlaylist(state.settings.activePlaylistId);
  if (!playlist?.tracks.length || !hasButton(playlist.id) || gameOf(playlist).stoppedAt || state.playback.mode) return;
  let remote;
  try {
    remote = await spotify.getPlaybackState();
  } catch {
    return;
  }
  const game = gameOf(playlist);
  const index = wrap(game.currentIndex, playlist.tracks.length);
  const track = playlist.tracks[index];
  if (!remote?.is_playing || !isOurTrack(remote.item, track.uri) || state.playback.mode) return;
  const now = Date.now();
  const startedFrom = game.positionMs ?? track.startMs;
  saveGame(playlist, {
    ...game,
    positionMs: remote.progress_ms,
    playedMs: game.playedMs + Math.max(0, remote.progress_ms - startedFrom),
  });
  state.playback = {
    ...idlePlayback(),
    status: 'playing',
    mode: 'game',
    playlistId: playlist.id,
    index,
    uri: track.uri,
    durationMs: remote.item.duration_ms || track.durationMs,
    endMs: track.endMs ?? null,
    positionMs: remote.progress_ms,
    syncedAt: now,
    segmentStartedAt: now,
  };
  startLoops();
  render();
}

/* ---------- Wake lock and keyboard (G-8, G-9) ---------- */

let wakeLock = null;
let wakeLockPending = false;

async function updateWakeLock() {
  const wanted = state.view === 'game' && document.visibilityState === 'visible';
  if (wanted && !wakeLock && !wakeLockPending && 'wakeLock' in navigator) {
    wakeLockPending = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {
      wakeLock = null;
    } finally {
      wakeLockPending = false;
    }
  } else if (!wanted && wakeLock) {
    const lock = wakeLock;
    wakeLock = null;
    try {
      await lock.release();
    } catch {
      /* Already released. */
    }
  }
}

function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function bindGlobalEvents() {
  document.addEventListener('keydown', (event) => {
    if (state.view !== 'game' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (document.querySelector('dialog[open]') || isTypingTarget(event.target)) return;
    const button = KEY_BUTTONS.indexOf(event.key);
    if (button >= 0) {
      const playlistId = state.settings.buttons[button];
      if (!playlistId || !findPlaylist(playlistId)) return;
      event.preventDefault();
      if (!event.repeat) pressButton(playlistId);
      return;
    }
    const playlist = lastGroupPlaylist();
    if (!playlist) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) pressButton(playlist.id);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(playlist.id, 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(playlist.id, -1);
    }
  });
  // Stops a focused button from also reacting to the Space key on release.
  document.addEventListener('keyup', (event) => {
    if (state.view === 'game' && event.code === 'Space' && !isTypingTarget(event.target)) event.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isGamePlaying()) schedulePoll(0);
    if (document.visibilityState === 'visible') checkForUpdate();
    updateWakeLock();
  });
}

/* ---------- Updates (SPEC §4.8) ---------- */

/** Registers the service worker that keeps every page load on the latest files (U-1). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(SERVICE_WORKER_URL, { updateViaCache: 'none' }).catch(() => {
    /* Not supported here: the browser cache rules apply. */
  });
}

/** Compares the running version with the deployed one, and shows the update banner when they differ (U-2). */
async function checkForUpdate() {
  if (state.updateVersion) return;
  try {
    const deployed = await import(`./version.js?check=${Date.now()}`);
    if (deployed.APP_VERSION && deployed.APP_VERSION !== APP_VERSION) {
      state.updateVersion = deployed.APP_VERSION;
      render();
    }
  } catch {
    /* Offline or not deployed yet: try again later. */
  }
}

/* ---------- Playlists (SPEC §4.3) ---------- */

async function createPlaylist() {
  const name = await ui.promptDialog({
    title: t('playlists.newTitle'),
    label: t('playlists.nameLabel'),
    placeholder: t('playlists.namePlaceholder'),
    confirmLabel: t('playlists.create'),
  });
  if (!name) return;
  const now = new Date().toISOString();
  const playlist = { id: store.newId(), name, createdAt: now, updatedAt: now, tracks: [] };
  state.playlists.push(playlist);
  savePlaylists();
  if (!groupPlaylists().length) assignButton(playlist.id, 0);
  ui.toast(t('playlists.toast.created', { name }), 'success');
  openPlaylist(playlist.id);
}

function openPlaylist(id) {
  stopPreview();
  state.view = 'playlists';
  state.editingPlaylistId = id;
  state.expandedTrack = null;
  state.search = emptySearch();
  render();
  window.scrollTo(0, 0);
}

function closePlaylist() {
  stopPreview();
  state.editingPlaylistId = null;
  state.expandedTrack = null;
  state.search = emptySearch();
  render();
  window.scrollTo(0, 0);
}

async function renamePlaylist(id) {
  const playlist = findPlaylist(id);
  if (!playlist) return;
  const name = await ui.promptDialog({
    title: t('editor.renameTitle'),
    label: t('playlists.nameLabel'),
    value: playlist.name,
    confirmLabel: t('editor.rename'),
  });
  if (!name || name === playlist.name) return;
  playlist.name = name;
  touch(playlist);
  savePlaylists();
  render();
}

function duplicatePlaylist(id) {
  const playlist = findPlaylist(id);
  if (!playlist) return;
  const now = new Date().toISOString();
  const copyName = `${playlist.name}${t('playlists.copySuffix')}`;
  const duplicate = { ...structuredClone(playlist), id: store.newId(), name: copyName, createdAt: now, updatedAt: now };
  state.playlists.splice(state.playlists.indexOf(playlist) + 1, 0, duplicate);
  savePlaylists();
  ui.toast(t('playlists.toast.duplicated', { name: copyName }), 'success');
  openPlaylist(duplicate.id);
}

async function deletePlaylist(id) {
  const playlist = findPlaylist(id);
  if (!playlist) return;
  if (playingPlaylistId() === id) {
    ui.toast(t('playlists.toast.stopFirst'), 'error');
    return;
  }
  const confirmed = await ui.confirmDialog({
    title: t('editor.deleteTitle'),
    message: t('editor.deleteBody', { name: playlist.name }),
    confirmLabel: t('editor.delete'),
    danger: true,
  });
  if (!confirmed) return;
  stopPreview();
  state.playlists = state.playlists.filter((candidate) => candidate.id !== id);
  ensureButtons();
  savePlaylists();
  ui.toast(t('playlists.toast.deleted', { name: playlist.name }));
  closePlaylist();
}

function exportFilename() {
  return `hockey-dj-playlists-${new Date().toISOString().slice(0, 10)}.json`;
}

function exportPlaylist(id) {
  const playlist = findPlaylist(id);
  if (!playlist) return;
  ui.downloadFile(exportFilename(), store.buildExport([playlist]));
  ui.toast(t('playlists.toast.exported', { what: tn('count.playlists', 1) }), 'success');
}

function exportAll() {
  if (!state.playlists.length) return;
  ui.downloadFile(exportFilename(), store.buildExport(state.playlists));
  ui.toast(t('playlists.toast.exported', { what: tn('count.playlists', state.playlists.length) }), 'success');
}

async function importFile() {
  const file = await ui.pickFile('.json,application/json');
  if (!file) return;
  try {
    const text = await file.text();
    const result = store.parseImport(text, {
      existingIds: state.playlists.map((playlist) => playlist.id),
      suffix: t('import.suffix'),
    });
    state.playlists.push(...result.playlists);
    savePlaylists();
    render();
    ui.toast(t('import.done', {
      playlists: tn('count.playlists', result.playlists.length),
      songs: tn('count.songs', result.trackCount),
    }), 'success');
  } catch (error) {
    const code = error instanceof store.ImportError ? error.code : 'invalid';
    ui.toast(t(`import.error.${code}`), 'error');
  }
}

/* ---------- Search (P-2) ---------- */

let searchTimer = null;
let searchSequence = 0;

function searchInput(query) {
  state.search.query = query;
  clearTimeout(searchTimer);
  if (!query.trim()) {
    searchSequence += 1;
    state.search = emptySearch();
    ui.updateSearchResults(state, actions);
    return;
  }
  searchTimer = setTimeout(() => runSearch(false), SEARCH_DEBOUNCE_MS);
}

async function runSearch(more) {
  clearTimeout(searchTimer);
  const query = state.search.query.trim();
  if (!query || (more && state.search.loading)) return;
  const sequence = ++searchSequence;
  const offset = more ? state.search.offset + state.search.results.length : 0;
  state.search = more
    ? { ...state.search, loading: true, error: '' }
    : { ...emptySearch(), query: state.search.query, loading: true };
  ui.updateSearchResults(state, actions);
  try {
    const trackId = spotify.parseTrackInput(query);
    let items;
    let hasMore = false;
    if (trackId) {
      items = [await spotify.getTrack(trackId)];
    } else {
      const page = await spotify.searchTracks(query, offset);
      items = page.items;
      hasMore = page.hasMore;
    }
    if (sequence !== searchSequence) return;
    const results = more ? [...state.search.results, ...items] : items;
    state.search = { ...state.search, results, loading: false, hasMore, offset: more ? state.search.offset : 0, done: true };
  } catch (error) {
    if (sequence !== searchSequence) return;
    if (error.code === 'NOT_CONNECTED') {
      handleError(error);
      return;
    }
    state.search = { ...state.search, loading: false, error: errorMessage(error), done: true };
  }
  ui.updateSearchResults(state, actions);
}

/** Adds one track to the playlist being edited. A track that is already in it is never added twice (P-2). */
function addTrack(track) {
  const playlist = findPlaylist(state.editingPlaylistId);
  if (!playlist) return;
  if (playlist.tracks.some((existing) => existing.id === track.id)) {
    ui.toast(t('editor.alreadyAdded', { name: track.name }));
    return;
  }
  playlist.tracks.push({ ...track, startMs: 0, endMs: null });
  touch(playlist);
  savePlaylists();
  render();
}

/* ---------- Spotify playlist import (P-9) ---------- */

/** Lets the user pick one of their Spotify playlists and appends its songs, skipping duplicates. */
async function importSpotifyPlaylist() {
  const playlistId = state.editingPlaylistId;
  if (!findPlaylist(playlistId) || state.spotifyImporting) return;

  const picker = ui.openSpotifyPlaylistPicker();
  spotify.getImportablePlaylists().then(picker.show, (error) => {
    if (error.code === 'NOT_CONNECTED') {
      picker.close();
      handleError(error);
      return;
    }
    picker.fail(errorMessage(error));
  });
  const choice = await picker.result;
  if (!choice) return;

  state.spotifyImporting = true;
  render();
  let result;
  try {
    result = await spotify.getPlaylistTracks(choice.id);
  } catch (error) {
    state.spotifyImporting = false;
    render();
    handleError(error);
    return;
  }
  state.spotifyImporting = false;

  const playlist = findPlaylist(playlistId);
  if (!playlist) {
    render();
    return;
  }
  const known = new Set(playlist.tracks.map((track) => track.id));
  let added = 0;
  let skipped = 0;
  for (const track of result.tracks) {
    if (known.has(track.id)) {
      skipped += 1;
      continue;
    }
    known.add(track.id);
    playlist.tracks.push({ ...track, startMs: 0, endMs: null });
    added += 1;
  }
  if (added) {
    touch(playlist);
    savePlaylists();
  }
  render();

  const parts = [added ? tn('spotifyImport.added', added) : t('spotifyImport.noneAdded')];
  if (skipped) parts.push(tn('spotifyImport.skipped', skipped));
  if (result.unavailable) parts.push(tn('spotifyImport.unavailable', result.unavailable));
  ui.toast(parts.join(' · '), added ? 'success' : 'info');
}

/* ---------- Track editing (P-4 to P-7) ---------- */

function toggleTrack(index) {
  state.expandedTrack = state.expandedTrack === index ? null : index;
  render();
}

function setStartMs(playlistId, index, value) {
  const playlist = findPlaylist(playlistId);
  const track = playlist?.tracks[index];
  if (!track) return;
  const rounded = Math.round(value / START_STEP_MS) * START_STEP_MS;
  const clamped = clamp(rounded, 0, maxStart(track));
  if (clamped !== rounded) ui.toast(t('editor.toast.clamped', { time: ui.formatTime(clamped) }), 'error');
  track.startMs = clamped;
  if (track.endMs != null && track.endMs < clamped + MIN_TAIL_MS) {
    track.endMs = null;
    ui.toast(t('editor.toast.endCleared'), 'error');
  }
  touch(playlist);
  savePlaylists();
  render();
}

/** Sets or clears (null) the end of a track (P-10). An end at or past the end of the song is cleared. */
function setEndMs(playlistId, index, value) {
  const playlist = findPlaylist(playlistId);
  const track = playlist?.tracks[index];
  if (!track) return false;
  let endMs = null;
  if (value != null) {
    const rounded = Math.round(value / START_STEP_MS) * START_STEP_MS;
    const earliest = track.startMs + MIN_TAIL_MS;
    if (rounded < earliest) {
      ui.toast(t('editor.toast.endBeforeStart', { time: ui.formatTime(earliest) }), 'error');
      render();
      return false;
    }
    endMs = rounded >= track.durationMs ? null : rounded;
  }
  track.endMs = endMs;
  const playback = state.playback;
  const ownerId = playback.mode === 'game' ? playback.playlistId : playback.previewKey?.playlistId;
  if (playback.mode && ownerId === playlistId && playback.uri === track.uri) {
    // The new end applies to the preview or game track that is playing now.
    playback.endMs = endMs;
    if (isGamePlaying()) scheduleHandoff();
  }
  touch(playlist);
  savePlaylists();
  render();
  return true;
}

function setEnd(playlistId, index, text) {
  if (!String(text || '').trim()) {
    setEndMs(playlistId, index, null);
    return;
  }
  const value = ui.parseTime(text);
  if (value == null) {
    ui.toast(t('editor.toast.invalidTime'), 'error');
    render();
    return;
  }
  setEndMs(playlistId, index, value);
}

function clearEnd(playlistId, index) {
  setEndMs(playlistId, index, null);
}

function clearStart(playlistId, index) {
  setStartMs(playlistId, index, 0);
}

function setStart(playlistId, index, text) {
  const value = ui.parseTime(text);
  if (value == null) {
    ui.toast(t('editor.toast.invalidTime'), 'error');
    render();
    return;
  }
  setStartMs(playlistId, index, value);
}

function stopPreview() {
  const playback = state.playback;
  if (playback.mode !== 'preview') return;
  state.playback = idlePlayback();
  if (playback.status === 'playing') spotify.pause(pauseDeviceId()).catch(() => {});
}

async function previewToggle(playlistId, index) {
  const playback = state.playback;
  if (playback.busy) return;
  if (isGamePlaying()) {
    ui.toast(t('editor.toast.stopGameFirst'), 'error');
    return;
  }
  const track = findPlaylist(playlistId)?.tracks[index];
  if (!track) return;
  const same = isPreviewing() && playback.previewKey?.playlistId === playlistId && playback.previewKey?.index === index;
  if (same) {
    state.playback = { ...playback, busy: true };
    render();
    try {
      await spotify.pause(pauseDeviceId());
    } catch (error) {
      handleError(error);
    }
    state.playback = idlePlayback();
    render();
    return;
  }
  unlockBrowserAudio();
  state.playback = { ...idlePlayback(), status: 'playing', mode: 'preview', busy: true, previewKey: { playlistId, index }, uri: track.uri, durationMs: track.durationMs, endMs: track.endMs ?? null, positionMs: track.startMs };
  render();
  try {
    const deviceId = await ensureDevice();
    await playOnDevice(track.uri, track.startMs, deviceId);
    state.playback = { ...state.playback, busy: false, syncedAt: Date.now() };
  } catch (error) {
    state.playback = idlePlayback();
    handleError(error);
  }
  render();
}

/** Saves the preview position as the start or the end of the track (P-4, P-10). */
async function markHere(playlistId, index, which = 'start') {
  const playback = state.playback;
  if (!isPreviewing() || playback.previewKey?.playlistId !== playlistId || playback.previewKey?.index !== index) return;
  let positionMs = estimateProgress();
  try {
    const remote = await spotify.getPlaybackState();
    if (isOurTrack(remote?.item, playback.uri) && Number.isFinite(remote.progress_ms)) {
      positionMs = remote.progress_ms;
      playback.positionMs = remote.progress_ms;
      playback.syncedAt = Date.now();
    }
  } catch {
    /* Keep the local estimate. */
  }
  if (which === 'end') {
    if (!setEndMs(playlistId, index, positionMs)) return;
    const track = findPlaylist(playlistId)?.tracks[index];
    if (track) ui.toast(t('editor.toast.endSet', { time: ui.formatTime(endOf(track)) }), 'success');
    return;
  }
  setStartMs(playlistId, index, positionMs);
  const track = findPlaylist(playlistId)?.tracks[index];
  if (track) ui.toast(t('editor.toast.startSet', { time: ui.formatTime(track.startMs) }), 'success');
}

function moveTrack(playlistId, index, delta) {
  const playlist = findPlaylist(playlistId);
  const target = index + delta;
  if (!playlist || target < 0 || target >= playlist.tracks.length) return;
  const [track] = playlist.tracks.splice(index, 1);
  playlist.tracks.splice(target, 0, track);
  touch(playlist);
  savePlaylists();
  const swap = (value) => {
    if (value === index) return target;
    if (value === target) return index;
    return value;
  };
  if (state.expandedTrack != null) state.expandedTrack = swap(state.expandedTrack);
  if (state.playback.previewKey?.playlistId === playlistId) state.playback.previewKey.index = swap(state.playback.previewKey.index);
  if (state.playback.mode === 'game' && state.playback.playlistId === playlistId) state.playback.index = swap(state.playback.index);
  const game = state.games[playlistId];
  if (game) saveGame(playlist, { ...game, currentIndex: swap(game.currentIndex) });
  render();
}

function removeTrack(playlistId, index) {
  const playlist = findPlaylist(playlistId);
  if (!playlist) return;
  const isPlaying = playingPlaylistId() === playlistId;
  if (isPlaying && state.playback.index === index) {
    ui.toast(t('editor.toast.playingNow'), 'error');
    return;
  }
  const previewKey = state.playback.previewKey;
  if (previewKey?.playlistId === playlistId) {
    if (previewKey.index === index) stopPreview();
    else if (previewKey.index > index) previewKey.index -= 1;
  }
  const [removed] = playlist.tracks.splice(index, 1);
  touch(playlist);
  savePlaylists();
  state.expandedTrack = null;
  if (state.playback.mode === 'game' && state.playback.playlistId === playlistId && index < state.playback.index) state.playback.index -= 1;
  const game = state.games[playlistId];
  if (game) {
    let { currentIndex, positionMs, playedMs, stoppedAt } = game;
    if (index < currentIndex) currentIndex -= 1;
    else if (index === currentIndex) {
      positionMs = null;
      playedMs = 0;
      stoppedAt = null;
    }
    currentIndex = playlist.tracks.length ? wrap(currentIndex, playlist.tracks.length) : 0;
    saveGame(playlist, { ...game, currentIndex, positionMs, playedMs, stoppedAt });
  }
  ui.toast(t('editor.toast.removed', { name: removed.name }));
  render();
}

/* ---------- Reset (S-5) ---------- */

async function confirmReset() {
  const confirmed = await ui.typedConfirmDialog({
    title: t('settings.resetTitle'),
    message: t('settings.resetBody'),
    word: t('settings.resetWord'),
    confirmLabel: t('settings.reset'),
  });
  if (!confirmed) return;
  stopLoops();
  store.resetAll();
  location.replace(state.redirectUri);
}

/* ---------- Start-up ---------- */

function initialView() {
  if (!state.connected || state.justConnected) return 'setup';
  return state.playlists.length ? 'game' : 'playlists';
}

async function init() {
  applyLanguage();
  applyTheme();
  bindGlobalEvents();

  if (spotify.hasAuthCallback()) {
    ui.renderSplash(root, t('setup.connecting'));
    try {
      await spotify.completeLogin();
      state.justConnected = true;
      ui.toast(t('setup.toast.connected'), 'success');
    } catch (error) {
      state.notice = errorMessage(error);
    }
  }

  state.connected = spotify.isConnected();
  if (state.connected && !spotify.hasRequiredScopes()) {
    spotify.logout();
    state.connected = false;
    state.notice = t('setup.notice.reconnect');
  }

  registerServiceWorker();
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  ensureButtons();
  syncGames();
  state.view = initialView();
  render();
  setInterval(tick, TICK_MS);

  if (state.connected) {
    startBrowserPlayback();
    loadProfile();
    await refreshDevices({ silent: true });
    restorePlayback();
  }
}

init();
