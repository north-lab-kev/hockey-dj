/**
 * app.js
 * Bootstrap, OAuth callback handling, view routing and app state (SPEC §6).
 * Implements the Play/Stop rules of SPEC §4.2.1 and the playback model of SPEC §3.4.
 */
import * as store from './storage.js';
import * as spotify from './spotify.js';
import { t, tn, has, setLanguage, resolveLanguage } from './i18n.js';
import * as ui from './ui.js';

const APP_VERSION = '0.1.0';

const ADVANCE_AFTER_PLAYED_MS = 20_000; // R-2 (a)
const ADVANCE_AFTER_IDLE_MS = 60_000; // R-2 (b)
const POLL_INTERVAL_MS = 5_000; // SPEC §3.4
const HANDOFF_LEAD_MS = 1_000; // R-5
const END_TOLERANCE_MS = 3_000; // SPEC §3.4 fallback
const POLL_GRACE_MS = 2_500;
const TICK_MS = 250;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_TAIL_MS = 1_000; // P-7: a start must stay before the end of the track
const START_STEP_MS = 100;
const THEME_COLORS = { light: '#EEF3F7', dark: '#0B1424' };

const root = document.getElementById('app');

function idlePlayback() {
  return {
    status: 'stopped',
    mode: null,
    busy: false,
    index: 0,
    uri: null,
    durationMs: 0,
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
  playback: idlePlayback(),
  appVersion: APP_VERSION,
};

const actions = {
  navigate,
  setLanguage: setLanguagePreference,
  setTheme: setThemePreference,
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
  selectTrack,
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
  toggleTrack,
  previewToggle,
  markHere,
  nudgeStart,
  setStart,
  moveTrack,
  removeTrack,
  resetAll: confirmReset,
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

function saveGame(game) {
  state.game = game;
  store.setGame(game);
}

function savePlaylists() {
  if (!store.savePlaylists(state.playlists)) ui.toast(t('errors.STORAGE'), 'error');
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
  if (isPreviewing() && !state.playback.busy && estimateProgress() >= state.playback.durationMs) {
    state.playback = idlePlayback();
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

function markDisconnected() {
  stopLoops();
  spotify.logout();
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
    spotify.logout();
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
  spotify.logout();
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

/** Returns the device to play on, picking one automatically when there is no doubt. */
async function ensureDevice() {
  if (state.settings.deviceId) return state.settings.deviceId;
  const devices = (await refreshDevices({ silent: true })).filter((device) => !device.is_restricted);
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

function shouldAdvance(game, now) {
  if (!game.stoppedAt) return false;
  const idleMs = now - Date.parse(game.stoppedAt);
  return game.playedMs >= ADVANCE_AFTER_PLAYED_MS || idleMs > ADVANCE_AFTER_IDLE_MS;
}

/** What the next Play will do (R-2, R-3, R-9). */
function planPlay(now = Date.now()) {
  const tracks = activePlaylist().tracks;
  const game = state.game;
  const index = wrap(game.currentIndex, tracks.length);
  if (shouldAdvance(game, now)) {
    const next = wrap(index + 1, tracks.length);
    return { index: next, positionMs: tracks[next].startMs, status: 'next' };
  }
  const track = tracks[index];
  const positionMs = clamp(game.positionMs ?? track.startMs, 0, maxStart(track));
  return { index, positionMs, status: game.stoppedAt ? 'resume' : 'start' };
}

/** Describes the Game screen: the track Play will start (or is playing) and its status. */
function describeGame(now = Date.now()) {
  const playlist = activePlaylist();
  if (!playlist || !playlist.tracks.length) return null;
  const tracks = playlist.tracks;
  const playback = state.playback;
  let plan;
  if (playback.mode === 'game' && playback.status === 'playing') {
    plan = { index: wrap(playback.index, tracks.length), positionMs: estimateProgress(now), status: 'playing' };
  } else {
    plan = planPlay(now);
  }
  const track = tracks[plan.index];
  const thenIndex = wrap(plan.index + 1, tracks.length);
  return {
    playlist,
    playing: plan.status === 'playing',
    busy: playback.busy,
    index: plan.index,
    status: plan.status,
    positionMs: plan.positionMs,
    durationMs: playback.mode === 'game' && plan.status === 'playing' ? playback.durationMs : track.durationMs,
    track,
    thenTrack: tracks[thenIndex],
  };
}

async function playStop() {
  if (state.playback.busy) return;
  if (isGamePlaying()) {
    await stopGame();
    return;
  }
  const playlist = activePlaylist();
  if (!playlist || !playlist.tracks.length) {
    ui.toast(t('game.toast.empty'), 'error');
    return;
  }
  if (state.playback.mode === 'preview') state.playback = idlePlayback();
  const plan = planPlay();
  await startGameTrack(plan.index, plan.positionMs, { resetPlayed: plan.status === 'next' });
}

/** Starts a track of the active playlist. Returns true on success. */
async function startGameTrack(index, positionMs, { resetPlayed }) {
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
  saveGame({ currentIndex: index, positionMs, playedMs: sameTrack ? state.game.playedMs : 0, stoppedAt: null });
  startLoops();
  render();
  return true;
}

/** Stop (R-1). `external` means playback was already paused from Spotify. */
async function stopGame({ external = false } = {}) {
  const playback = state.playback;
  const now = Date.now();
  const positionMs = clamp(estimateProgress(now), 0, Math.max(0, playback.durationMs - MIN_TAIL_MS));
  const segmentMs = Math.max(0, now - playback.segmentStartedAt);
  stopLoops();
  if (!external) {
    state.playback = { ...playback, status: 'stopped', busy: true };
    render();
    try {
      await spotify.pause(state.settings.deviceId);
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
  const next = wrap(state.playback.index + 1, tracks.length);
  const started = await startGameTrack(next, tracks[next].startMs, { resetPlayed: true });
  if (!started) {
    saveGame({ currentIndex: next, positionMs: null, playedMs: 0, stoppedAt: null });
    render();
  }
}

/** Explicit selection (R-7). */
async function selectTrack(index) {
  const playlist = activePlaylist();
  if (!playlist?.tracks.length || state.playback.busy) return;
  const target = wrap(index, playlist.tracks.length);
  if (isGamePlaying()) {
    await startGameTrack(target, playlist.tracks[target].startMs, { resetPlayed: true });
    return;
  }
  saveGame({ currentIndex: target, positionMs: null, playedMs: 0, stoppedAt: null });
  render();
}

function step(delta) {
  const descriptor = describeGame();
  if (descriptor) selectTrack(descriptor.index + delta);
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
  const remaining = state.playback.durationMs - estimateProgress();
  handoffTimer = setTimeout(continueToNext, Math.max(0, remaining - HANDOFF_LEAD_MS));
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
  const nearEnd = playback.durationMs - estimateProgress(now) <= END_TOLERANCE_MS
    || (sameTrack && remote.progress_ms >= playback.durationMs - END_TOLERANCE_MS);
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
    updateWakeLock();
  });
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

function addTrack(track) {
  const playlist = findPlaylist(state.editingPlaylistId);
  if (!playlist || playlist.tracks.some((existing) => existing.id === track.id)) return;
  playlist.tracks.push({ ...track, startMs: 0 });
  touch(playlist);
  savePlaylists();
  if (playlist.tracks.length === 1 && !activePlaylist()) ensureActivePlaylist();
  render();
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
  touch(playlist);
  savePlaylists();
  render();
}

function nudgeStart(playlistId, index, deltaMs) {
  const track = findPlaylist(playlistId)?.tracks[index];
  if (track) setStartMs(playlistId, index, track.startMs + deltaMs);
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
  if (playback.status === 'playing') spotify.pause(state.settings.deviceId).catch(() => {});
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
      await spotify.pause(state.settings.deviceId);
    } catch (error) {
      handleError(error);
    }
    state.playback = idlePlayback();
    render();
    return;
  }
  state.playback = { ...idlePlayback(), status: 'playing', mode: 'preview', busy: true, previewKey: { playlistId, index }, uri: track.uri, durationMs: track.durationMs, positionMs: track.startMs };
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

async function markHere(playlistId, index) {
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
    saveGame({ currentIndex, positionMs, playedMs, stoppedAt });
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

  ensureActivePlaylist();
  state.view = initialView();
  render();
  setInterval(tick, TICK_MS);

  if (state.connected) {
    loadProfile();
    await refreshDevices({ silent: true });
    restorePlayback();
  }
}

init();
