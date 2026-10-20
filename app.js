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
const POLL_GRACE_MS = 2_500;
const TICK_MS = 250;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_TAIL_MS = 1_000; // P-7, P-10: a start must stay at least this long before the end
const START_STEP_MS = 100;
const THEME_COLORS = { light: '#EEF3F7', dark: '#0B1424' };

const ADVANCE_SETTINGS = Object.freeze({
  played: { key: 'advanceAfterPlayedMs', defaultMs: ADVANCE_AFTER_PLAYED_MS, minMs: ADVANCE_PLAYED_MIN_MS, maxMs: ADVANCE_PLAYED_MAX_MS },
  idle: { key: 'advanceAfterIdleMs', defaultMs: ADVANCE_AFTER_IDLE_MS, minMs: ADVANCE_IDLE_MIN_MS, maxMs: ADVANCE_IDLE_MAX_MS },
});

const root = document.getElementById('app');

function idlePlayback() {
  return {
    status: 'stopped',
    mode: null,
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
  game: store.getGame(),
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
  playStop,
  prev: () => step(-1),
  next: () => step(1),
  selectTrack: (index) => selectTrack(index, describeGame()?.shuffle),
  setActivePlaylist,
  describeGame,
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

function activePlaylist() {
  return state.playlists.find((playlist) => playlist.id === state.settings.activePlaylistId) || null;
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

/** Estimated position of the track that is playing now, in milliseconds. */
function estimateProgress(now = Date.now()) {
  const playback = state.playback;
  if (playback.status !== 'playing' || playback.busy) return playback.positionMs;
  const position = playback.positionMs + (now - playback.syncedAt);
  return playback.durationMs ? Math.min(position, playback.durationMs) : position;
}

/** Saves the game state, after making its shuffle passes match the active playlist (R-11 to R-14). */
function saveGame(game, options) {
  state.game = withShuffle(game, options);
  store.setGame(state.game);
}

function savePlaylists() {
  if (!store.savePlaylists(state.playlists)) ui.toast(t('errors.STORAGE'), 'error');
  saveGame(state.game);
}

function touch(playlist) {
  playlist.updatedAt = new Date().toISOString();
}

/* ---------- Rendering ---------- */

let lastGameKey = '';

function gameKey() {
  const descriptor = describeGame();
  return descriptor ? `${descriptor.status}:${descriptor.index}:${descriptor.busy}` : 'none';
}

function render() {
  ui.renderApp(root, state, actions);
  lastGameKey = gameKey();
  if (state.view === 'game') ui.keepCurrentInView(root);
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
    else ui.updateLive(root, describeGame());
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

/**
 * Returns the game state with valid shuffle passes, or `shuffle: null` when shuffle is off (R-11 to R-14).
 * A new game starts on a random track, unless `keepCurrent` is set.
 */
function withShuffle(game, { keepCurrent = false } = {}) {
  const tracks = activePlaylist()?.tracks || [];
  if (!state.settings.shuffle || !tracks.length) return { ...game, shuffle: null };
  const ids = tracks.map((track) => track.id);
  const index = wrap(game.currentIndex, tracks.length);
  const current = game.shuffle;
  if (!current || !isPass(current.order)) {
    const fresh = !keepCurrent && state.playback.mode !== 'game' && !game.stoppedAt && !game.playedMs && game.positionMs == null;
    const order = fresh ? shuffled(ids) : [ids[index], ...shuffled(ids.filter((id) => id !== ids[index]))];
    return {
      ...game,
      currentIndex: fresh ? ids.indexOf(order[0]) : index,
      shuffle: { past: null, order, upcoming: avoidRepeat(shuffled(ids), order[order.length - 1]) },
    };
  }
  const order = repairPass(current.order, ids, (kept) => kept.indexOf(ids[index]) + 1);
  const upcoming = isPass(current.upcoming) ? repairPass(current.upcoming, ids, () => 1) : shuffled(ids);
  return {
    ...game,
    shuffle: {
      past: samePass(current.past, ids) ? current.past : null,
      order,
      upcoming: avoidRepeat(upcoming, order[order.length - 1]),
    },
  };
}

/**
 * Where a move of `delta` (+1 or -1) from the track at `index` lands (R-6, R-7, R-12).
 * Returns the playlist index and the shuffle passes after the move. A new pass gets
 * its own `upcoming` pass when the game state is saved.
 */
function moveFrom(index, delta, shuffle = state.game.shuffle) {
  const tracks = activePlaylist().tracks;
  if (!shuffle) return { index: wrap(index + delta, tracks.length), shuffle: null };
  const indexOf = (id) => Math.max(0, tracks.findIndex((track) => track.id === id));
  const { past, order } = shuffle;
  const upcoming = shuffle.upcoming || order;
  const target = order.indexOf(tracks[index]?.id) + delta;
  if (target >= order.length) return { index: indexOf(upcoming[0]), shuffle: { past: order, order: upcoming, upcoming: null } };
  if (target < 0 && past) return { index: indexOf(past[past.length - 1]), shuffle: { past: null, order: past, upcoming: order } };
  return { index: indexOf(order[wrap(target, order.length)]), shuffle };
}

/** Turns shuffle on or off (S-9). The current track stays where it is. */
function setShuffle(enabled) {
  state.settings = store.updateSettings({ shuffle: enabled });
  saveGame({ ...state.game, shuffle: null }, { keepCurrent: true });
  render();
}

/** What the next Play will do (R-2, R-3, R-9). */
function planPlay(now = Date.now()) {
  const tracks = activePlaylist().tracks;
  const game = state.game;
  const index = wrap(game.currentIndex, tracks.length);
  if (shouldAdvance(game, now)) {
    const next = moveFrom(index, 1);
    return { index: next.index, positionMs: tracks[next.index].startMs, status: 'next', shuffle: next.shuffle };
  }
  const track = tracks[index];
  const positionMs = clamp(game.positionMs ?? track.startMs, 0, maxPosition(track));
  return { index, positionMs, status: game.stoppedAt ? 'resume' : 'start', shuffle: game.shuffle };
}

/** Describes the Game screen: the track Play will start (or is playing) and its status. */
function describeGame(now = Date.now()) {
  const playlist = activePlaylist();
  if (!playlist || !playlist.tracks.length) return null;
  const tracks = playlist.tracks;
  const playback = state.playback;
  let plan;
  if (playback.mode === 'game' && playback.status === 'playing') {
    plan = { index: wrap(playback.index, tracks.length), positionMs: estimateProgress(now), status: 'playing', shuffle: state.game.shuffle };
  } else {
    plan = planPlay(now);
  }
  const track = tracks[plan.index];
  const thenIndex = moveFrom(plan.index, 1, plan.shuffle).index;
  const queue = plan.shuffle
    ? plan.shuffle.order.map((id) => tracks.findIndex((candidate) => candidate.id === id)).filter((index) => index >= 0)
    : tracks.map((_, index) => index);
  return {
    playlist,
    playing: plan.status === 'playing',
    busy: playback.busy,
    index: plan.index,
    status: plan.status,
    positionMs: plan.positionMs,
    durationMs: playback.mode === 'game' && plan.status === 'playing' ? playbackEnd(playback) : endOf(track),
    track,
    thenTrack: tracks[thenIndex],
    queue,
    shuffle: plan.shuffle,
  };
}

async function playStop() {
  if (state.playback.busy) return;
  if (isGamePlaying()) {
    await stopGame();
    return;
  }
  unlockBrowserAudio();
  const playlist = activePlaylist();
  if (!playlist || !playlist.tracks.length) {
    ui.toast(t('game.toast.empty'), 'error');
    return;
  }
  if (state.playback.mode === 'preview') state.playback = idlePlayback();
  const plan = planPlay();
  await startGameTrack(plan.index, plan.positionMs, { resetPlayed: plan.status === 'next', shuffle: plan.shuffle });
}

/** Starts a track of the active playlist. Returns true on success. */
async function startGameTrack(index, positionMs, { resetPlayed, shuffle = state.game.shuffle }) {
  const track = activePlaylist().tracks[index];
  stopLoops();
  state.playback = {
    ...idlePlayback(),
    status: 'playing',
    mode: 'game',
    busy: true,
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
    state.playback = idlePlayback();
    render();
    handleError(error);
    return false;
  }
  const now = Date.now();
  state.playback = { ...state.playback, busy: false, syncedAt: now, segmentStartedAt: now, ignorePollUntil: now + POLL_GRACE_MS };
  const sameTrack = index === state.game.currentIndex && !resetPlayed;
  saveGame({ currentIndex: index, positionMs, playedMs: sameTrack ? state.game.playedMs : 0, stoppedAt: null, shuffle });
  startLoops();
  render();
  return true;
}

/** Stop (R-1). `external` means playback was already paused from Spotify. */
async function stopGame({ external = false } = {}) {
  const playback = state.playback;
  const now = Date.now();
  const positionMs = clamp(estimateProgress(now), 0, Math.max(0, playbackEnd(playback) - MIN_TAIL_MS));
  const segmentMs = Math.max(0, now - playback.segmentStartedAt);
  stopLoops();
  if (!external) {
    state.playback = { ...playback, status: 'stopped', busy: true };
    render();
    try {
      await spotify.pause(pauseDeviceId());
    } catch (error) {
      state.playback = playback;
      startLoops();
      render();
      handleError(error);
      return;
    }
  }
  saveGame({
    ...state.game,
    positionMs,
    playedMs: state.game.playedMs + segmentMs,
    stoppedAt: new Date(now).toISOString(),
  });
  state.playback = idlePlayback();
  render();
}

/** End of track (R-5): play the next track of the playlist at its start. */
async function continueToNext() {
  if (!isGamePlaying() || state.playback.busy) return;
  const tracks = activePlaylist()?.tracks;
  if (!tracks?.length) return;
  const { index: next, shuffle } = moveFrom(state.playback.index, 1);
  const started = await startGameTrack(next, tracks[next].startMs, { resetPlayed: true, shuffle });
  if (!started) {
    saveGame({ currentIndex: next, positionMs: null, playedMs: 0, stoppedAt: null, shuffle });
    render();
  }
}

/** Explicit selection (R-7). In shuffle mode, play continues in the shuffled order from the selected track (R-13). */
async function selectTrack(index, shuffle = state.game.shuffle) {
  const playlist = activePlaylist();
  if (!playlist?.tracks.length || state.playback.busy) return;
  const target = wrap(index, playlist.tracks.length);
  if (isGamePlaying()) {
    unlockBrowserAudio();
    await startGameTrack(target, playlist.tracks[target].startMs, { resetPlayed: true, shuffle });
    return;
  }
  saveGame({ currentIndex: target, positionMs: null, playedMs: 0, stoppedAt: null, shuffle });
  render();
}

function step(delta) {
  const descriptor = describeGame();
  if (!descriptor) return;
  const move = moveFrom(descriptor.index, delta, descriptor.shuffle);
  selectTrack(move.index, move.shuffle);
}

function setActivePlaylist(id) {
  if (isGamePlaying() || state.playback.busy || !findPlaylist(id)) return;
  state.settings = store.updateSettings({ activePlaylistId: id });
  saveGame(store.defaultGame());
  render();
}

function ensureActivePlaylist() {
  if (activePlaylist()) return;
  const first = state.playlists[0];
  state.settings = store.updateSettings({ activePlaylistId: first ? first.id : null });
  saveGame(store.defaultGame());
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
  const sameTrack = remote?.item?.uri === playback.uri;
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
  const playlist = activePlaylist();
  if (!playlist?.tracks.length || state.game.stoppedAt || state.playback.mode) return;
  let remote;
  try {
    remote = await spotify.getPlaybackState();
  } catch {
    return;
  }
  const index = wrap(state.game.currentIndex, playlist.tracks.length);
  const track = playlist.tracks[index];
  if (!remote?.is_playing || remote.item?.uri !== track.uri || state.playback.mode) return;
  const now = Date.now();
  const startedFrom = state.game.positionMs ?? track.startMs;
  saveGame({
    ...state.game,
    positionMs: remote.progress_ms,
    playedMs: state.game.playedMs + Math.max(0, remote.progress_ms - startedFrom),
  });
  state.playback = {
    ...idlePlayback(),
    status: 'playing',
    mode: 'game',
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
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) playStop();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
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
  if (!activePlaylist()) ensureActivePlaylist();
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
  const isActive = playlist.id === state.settings.activePlaylistId;
  if (isActive && (isGamePlaying() || state.playback.busy)) {
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
  savePlaylists();
  if (isActive) {
    state.settings = store.updateSettings({ activePlaylistId: null });
    ensureActivePlaylist();
  }
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
    ensureActivePlaylist();
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
  if (playlist.tracks.length === 1 && !activePlaylist()) ensureActivePlaylist();
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
    if (!activePlaylist()) ensureActivePlaylist();
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
  if (playback.mode && playback.uri === track.uri) {
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
    if (remote?.item?.uri === playback.uri && Number.isFinite(remote.progress_ms)) {
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
  if (playlistId === state.settings.activePlaylistId) {
    if (state.playback.mode === 'game') state.playback.index = swap(state.playback.index);
    saveGame({ ...state.game, currentIndex: swap(state.game.currentIndex) });
  }
  render();
}

function removeTrack(playlistId, index) {
  const playlist = findPlaylist(playlistId);
  if (!playlist) return;
  const isActive = playlistId === state.settings.activePlaylistId;
  if (isActive && state.playback.mode === 'game' && (isGamePlaying() || state.playback.busy) && state.playback.index === index) {
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
  if (isActive) {
    let { currentIndex, positionMs, playedMs, stoppedAt } = state.game;
    if (index < currentIndex) currentIndex -= 1;
    else if (index === currentIndex) {
      positionMs = null;
      playedMs = 0;
      stoppedAt = null;
    }
    currentIndex = playlist.tracks.length ? wrap(currentIndex, playlist.tracks.length) : 0;
    if (state.playback.mode === 'game' && index < state.playback.index) state.playback.index -= 1;
    saveGame({ ...state.game, currentIndex, positionMs, playedMs, stoppedAt });
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
  ensureActivePlaylist();
  saveGame(state.game);
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
