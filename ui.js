/**
 * ui.js
 * Rendering of views and components, toasts and dialogs (SPEC §6, §7).
 * All user-facing text comes from i18n.js. Text that comes from Spotify or from
 * imported files is always inserted as text nodes, never as HTML.
 */
import { t, tn } from './i18n.js';
import { BROWSER_DEVICE_ID } from './storage.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TOAST_DURATION_MS = 3500;
const ERROR_TOAST_DURATION_MS = 6500;
const TOAST_EXIT_MS = 250;
const ADVANCE_NUDGE_MS = 5000;
const RING_RADIUS = 47;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const SPOTIFY_DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

/* ---------- DOM helpers ---------- */

function appendChildren(element, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Creates an HTML element. `on*` props become event listeners. */
export function h(tag, props, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'value') element.value = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  appendChildren(element, children);
  return element;
}

function svg(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes || {})) element.setAttribute(key, String(value));
  return element;
}

const FILLED = { fill: 'currentColor', stroke: 'none' };

const ICONS = {
  play: [['path', { d: 'M7 4.6v14.8a1 1 0 0 0 1.5.86l12.3-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6z', ...FILLED }]],
  stop: [['rect', { x: 5, y: 5, width: 14, height: 14, rx: 2.5, ...FILLED }]],
  prev: [['path', { d: 'M18 18.2V5.8a.8.8 0 0 0-1.27-.65L8.4 11.35a.8.8 0 0 0 0 1.3l8.33 6.2A.8.8 0 0 0 18 18.2z', ...FILLED }], ['path', { d: 'M6 5v14' }]],
  next: [['path', { d: 'M6 5.8v12.4a.8.8 0 0 0 1.27.65l8.33-6.2a.8.8 0 0 0 0-1.3L7.27 5.15A.8.8 0 0 0 6 5.8z', ...FILLED }], ['path', { d: 'M18 5v14' }]],
  rink: [['circle', { cx: 12, cy: 12, r: 8 }], ['circle', { cx: 12, cy: 12, r: 2.2, ...FILLED }], ['path', { d: 'M1.5 10h2.5M1.5 14h2.5M20 10h2.5M20 14h2.5' }]],
  list: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['circle', { cx: 4.5, cy: 6, r: 1.3, ...FILLED }], ['circle', { cx: 4.5, cy: 12, r: 1.3, ...FILLED }], ['circle', { cx: 4.5, cy: 18, r: 1.3, ...FILLED }]],
  sliders: [['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }], ['circle', { cx: 15, cy: 7, r: 2 }], ['circle', { cx: 9, cy: 17, r: 2 }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'm20 20-4.2-4.2' }]],
  trash: [['path', { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7' }]],
  up: [['path', { d: 'm6 15 6-6 6 6' }]],
  down: [['path', { d: 'm6 9 6 6 6-6' }]],
  back: [['path', { d: 'm15 18-6-6 6-6' }]],
  chevron: [['path', { d: 'm9 18 6-6-6-6' }]],
  check: [['path', { d: 'm5 12.5 4.5 4.5L19 7.5' }]],
  copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ['path', { d: 'M5 15V6a2 2 0 0 1 2-2h8' }]],
  external: [['path', { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]],
  refresh: [['path', { d: 'M20 11a8 8 0 0 0-14.7-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4L20 16M20 20v-4h-4' }]],
  close: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  laptop: [['rect', { x: 4, y: 5, width: 16, height: 11, rx: 1.5 }], ['path', { d: 'M2 19.5h20' }]],
  device: [['rect', { x: 6, y: 2.5, width: 12, height: 19, rx: 2.5 }], ['circle', { cx: 12, cy: 14.5, r: 3 }], ['circle', { cx: 12, cy: 7, r: 1, ...FILLED }]],
  flag: [['path', { d: 'M5 21V4M5 4h12l-2.5 4.5L17 13H5' }]],
  download: [['path', { d: 'M12 4v11M7 10l5 5 5-5M5 20h14' }]],
  upload: [['path', { d: 'M12 20V9M7 14l5-5 5 5M5 4h14' }]],
  edit: [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4' }]],
  duplicate: [['rect', { x: 8, y: 8, width: 12, height: 12, rx: 2 }], ['path', { d: 'M4 16V6a2 2 0 0 1 2-2h10' }]],
  logout: [['path', { d: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4' }]],
  alert: [['path', { d: 'M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' }]],
  music: [['path', { d: 'M9 18V5l11-2v13' }], ['circle', { cx: 6.5, cy: 18, r: 2.5 }], ['circle', { cx: 17.5, cy: 16, r: 2.5 }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v5M12 8h.01' }]],
};

/** Returns an inline SVG icon. Icons are decorative: label their buttons instead. */
export function icon(name, className = 'icon') {
  const element = svg('svg', { viewBox: '0 0 24 24', class: className, 'aria-hidden': 'true', focusable: 'false' });
  for (const [tag, attributes] of ICONS[name] || []) element.append(svg(tag, attributes));
  return element;
}

/** The Hockey DJ mark: a face-off circle. */
export function logoMark(extraClass = '') {
  const element = svg('svg', { viewBox: '0 0 48 48', class: `logo ${extraClass}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  element.append(
    svg('path', { class: 'logo__hash', d: 'M1.5 19.5h6M1.5 28.5h6M40.5 19.5h6M40.5 28.5h6' }),
    svg('circle', { class: 'logo__ring', cx: 24, cy: 24, r: 17 }),
    svg('circle', { class: 'logo__dot', cx: 24, cy: 24, r: 6 }),
  );
  return element;
}

/* ---------- Formatting ---------- */

/** Formats milliseconds as m:ss. */
export function formatTime(ms) {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Parses "m:ss" or a number of seconds into milliseconds. Returns null when invalid. */
export function parseTime(text) {
  const value = String(text || '').trim().replace(',', '.');
  let match = value.match(/^(\d{1,3}):([0-5]?\d(?:\.\d+)?)$/);
  if (match) return Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000);
  match = value.match(/^\d{1,5}(?:\.\d+)?$/);
  if (match) return Math.round(Number(value) * 1000);
  return null;
}

/** A track's start, or "start → end" when it has a marked end (P-10). */
function timeRange(track) {
  const start = formatTime(track.startMs);
  if (track.endMs == null) return [h('span', { class: 'sr-only' }, `${t('editor.startLabel')} `), start];
  const end = formatTime(track.endMs);
  return [h('span', { class: 'sr-only' }, t('editor.range', { start, end })), h('span', { 'aria-hidden': 'true' }, `${start} → ${end}`)];
}

function artistsText(track) {
  return (track?.artists || []).join(', ');
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function ringOffset(descriptor) {
  const progress = descriptor.durationMs ? clamp01(descriptor.positionMs / descriptor.durationMs) : 0;
  return (RING_LENGTH * (1 - progress)).toFixed(2);
}

function statusText(descriptor) {
  const time = formatTime(descriptor.positionMs);
  switch (descriptor.status) {
    case 'playing':
      return t('game.status.playing', { position: time, duration: formatTime(descriptor.durationMs) });
    case 'resume':
      return t('game.status.resume', { time });
    case 'next':
      return t('game.status.next', { time });
    default:
      return t('game.status.start', { time });
  }
}

/* ---------- Small components ---------- */

function cover(track, className) {
  if (track?.imageUrl) {
    return h('img', {
      class: `cover ${className}`,
      src: track.imageUrl,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    });
  }
  return h('span', { class: `cover cover--empty ${className}`, 'aria-hidden': 'true' }, icon('music'));
}

function button({ label, iconName, variant = 'secondary', onClick, disabled = false, focusKey, extraClass = '', ariaLabel, hideLabelOnMobile = false }) {
  return h('button', {
    type: 'button',
    class: `btn btn--${variant} ${extraClass}`.trim(),
    onclick: onClick,
    disabled,
    'data-focus': focusKey,
    'aria-label': ariaLabel,
  }, iconName ? icon(iconName) : null, label ? h('span', { class: hideLabelOnMobile ? 'btn__label btn__label--wide' : 'btn__label' }, label) : null);
}

function spinner() {
  return h('span', { class: 'spinner', 'aria-hidden': 'true' });
}

function deviceChip(state, actions) {
  const isBrowser = state.settings.deviceId === BROWSER_DEVICE_ID;
  const device = state.devices.find((candidate) => candidate.id === state.settings.deviceId);
  let label = t('devices.choose');
  let warn;
  if (isBrowser) {
    label = t('devices.browser');
    warn = state.browser.status === 'error' || state.browser.status === 'offline' || !state.browser.support;
  } else {
    if (device) label = device.name;
    else if (state.settings.deviceId && !state.devicesLoaded) label = t('devices.saved');
    warn = !device && !(state.settings.deviceId && !state.devicesLoaded);
  }
  return h('button', {
    type: 'button',
    class: `chip ${warn ? 'chip--warn' : ''}`,
    onclick: actions.openDevicePicker,
    'aria-label': t('devices.chipLabel', { name: label }),
  }, icon(warn ? 'alert' : 'device', 'icon icon--sm'), h('span', { class: 'chip__text' }, label));
}

const NAV_ITEMS = [
  ['game', 'rink', 'nav.game'],
  ['playlists', 'list', 'nav.playlists'],
  ['settings', 'sliders', 'nav.settings'],
];

function renderNav(state, actions, placement) {
  return h('nav', { class: `nav nav--${placement}`, 'aria-label': t('nav.label') },
    NAV_ITEMS.map(([view, iconName, key]) => h('button', {
      type: 'button',
      class: 'nav__item',
      'aria-current': state.view === view ? 'page' : null,
      onclick: () => actions.navigate(view),
    }, icon(iconName), h('span', {}, t(key)))));
}

function renderHeader(state, actions) {
  return h('header', { class: `topbar ${state.connected ? 'topbar--connected' : ''}` },
    h('div', { class: 'topbar__inner' },
      h('a', {
        class: 'brand',
        href: './',
        onclick: (event) => {
          event.preventDefault();
          if (state.connected) actions.navigate('game');
        },
      }, logoMark(), h('span', { class: 'brand__name' }, 'Hockey DJ')),
      state.connected ? renderNav(state, actions, 'top') : null,
      state.connected ? h('div', { class: 'topbar__tools' }, deviceChip(state, actions)) : null));
}

function copyField(id, value, actions) {
  return h('div', { class: 'copy-field' },
    h('input', { id, class: 'input input--mono', value, readonly: true, spellcheck: 'false' }),
    button({ iconName: 'copy', variant: 'secondary', extraClass: 'btn--icon', ariaLabel: t('common.copy'), onClick: () => actions.copy(value) }));
}

function clientIdForm(state, actions, idSuffix) {
  const inputId = `client-id-${idSuffix}`;
  return h('form', {
    class: 'field',
    onsubmit: (event) => {
      event.preventDefault();
      actions.saveClientId(event.currentTarget.elements.clientId.value);
    },
  },
  h('label', { class: 'field__label', for: inputId }, t('setup.clientIdLabel')),
  h('div', { class: 'inline-form' },
    h('input', {
      id: inputId,
      name: 'clientId',
      class: 'input input--mono',
      value: state.settings.clientId,
      placeholder: t('setup.clientIdPlaceholder'),
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      maxlength: 64,
      'data-focus': inputId,
    }),
    h('button', { type: 'submit', class: 'btn btn--secondary' }, t('common.save'))));
}

/** Help text above the device list: mentions this browser when it can play (B-2). */
function devicesHelp(state) {
  return t(state.browser.support ? 'devices.helpBrowser' : 'devices.help');
}

/** "This browser" entry of the device list (B-2). */
function browserDeviceItem(state, actions) {
  const browser = state.browser;
  const selected = state.settings.deviceId === BROWSER_DEVICE_ID;
  const ready = browser.status === 'ready';
  let meta = t(browser.support === 'android' ? 'devices.browserExperimental' : 'devices.browserMeta');
  if (browser.status === 'loading' || browser.status === 'off') meta = t('devices.browserLoading');
  else if (browser.status === 'offline') meta = t('devices.browserOffline');
  else if (browser.status === 'error') meta = browser.error;
  return h('li', {},
    h('label', { class: `device ${ready || selected ? '' : 'is-disabled'}` },
      h('input', {
        type: 'radio',
        name: 'device',
        value: BROWSER_DEVICE_ID,
        checked: selected,
        disabled: !ready && !selected,
        onchange: () => actions.selectDevice(BROWSER_DEVICE_ID),
      }),
      icon('laptop'),
      h('span', { class: 'device__text' },
        h('span', { class: 'device__name' }, t('devices.browser')),
        h('span', { class: 'device__meta' }, meta))));
}

/** Device list with radio buttons and a Refresh button (F-4, S-3, B-2). */
function deviceList(state, actions) {
  const devices = state.devices.filter((device) => !state.browser.id || device.id !== state.browser.id);
  const browserItem = state.browser.support ? browserDeviceItem(state, actions) : null;
  let content;
  if (devices.length || browserItem) {
    content = h('ul', { class: 'devices' }, browserItem, devices.map((device) => {
      const details = [t(`devices.type.${device.type}`, {}, device.type)];
      if (device.is_active) details.push(t('devices.active'));
      if (device.is_restricted) details.push(t('devices.restricted'));
      return h('li', {},
        h('label', { class: `device ${device.is_restricted ? 'is-disabled' : ''}` },
          h('input', {
            type: 'radio',
            name: 'device',
            value: device.id,
            checked: device.id === state.settings.deviceId,
            disabled: device.is_restricted,
            onchange: () => actions.selectDevice(device.id),
          }),
          icon('device'),
          h('span', { class: 'device__text' },
            h('span', { class: 'device__name' }, device.name),
            h('span', { class: 'device__meta' }, details.join(', ')))));
    }));
  } else {
    content = h('p', { class: 'hint hint--box' },
      state.devicesLoading ? spinner() : icon('info'),
      h('span', {}, state.devicesLoading ? t('devices.loading') : t('devices.none')));
  }
  return h('div', { class: 'device-picker' },
    content,
    button({
      label: t('devices.refresh'),
      iconName: 'refresh',
      variant: 'ghost',
      extraClass: 'btn--sm',
      onClick: actions.refreshDevices,
      disabled: state.devicesLoading,
      focusKey: 'devices-refresh',
    }));
}

/* ---------- Setup view (SPEC §4.1) ---------- */

function setupStep(number, title, done, body) {
  return h('li', { class: `step ${done ? 'is-done' : ''}` },
    h('span', { class: 'step__num', 'aria-hidden': 'true' }, done ? icon('check') : String(number)),
    h('div', { class: 'step__body' },
      h('h2', { class: 'step__title' },
        h('span', { class: 'sr-only' }, `${done ? t('setup.stepDone', { number }) : t('setup.stepNumber', { number })} `),
        title),
      body));
}

function renderSetup(state, actions) {
  const hasClientId = Boolean(state.settings.clientId);
  const connectedBody = [
    h('p', { class: 'step__text' }, state.profile ? t('setup.connectedAs', { name: state.profile.name }) : t('setup.connected')),
    h('p', { class: 'hint' }, t('setup.step3.devices')),
    deviceList(state, actions),
    button({ label: t('setup.continue'), iconName: 'chevron', variant: 'primary', onClick: actions.continueSetup, extraClass: 'btn--block' }),
  ];
  const connectBody = [
    h('p', { class: 'step__text' }, t('setup.step3.body')),
    button({
      label: t('setup.connect'),
      variant: 'primary',
      onClick: actions.connect,
      disabled: !hasClientId,
      extraClass: 'btn--block',
      focusKey: 'connect',
    }),
  ];

  return h('section', { class: 'setup' },
    h('div', { class: 'setup__hero' },
      logoMark('logo--hero'),
      h('h1', { class: 'setup__title display' }, 'Hockey DJ'),
      h('p', { class: 'setup__lead' }, t('setup.lead'))),
    state.notice ? h('p', { class: 'notice', role: 'alert' }, icon('alert'), h('span', {}, state.notice)) : null,
    h('ol', { class: 'steps' },
      setupStep(1, t('setup.step1.title'), hasClientId, [
        h('p', { class: 'step__text' }, t('setup.step1.body')),
        h('div', { class: 'field' },
          h('label', { class: 'field__label', for: 'redirect-uri' }, t('setup.redirectLabel')),
          copyField('redirect-uri', state.redirectUri, actions)),
        h('p', { class: 'hint' }, t('setup.step1.apis')),
        h('a', { class: 'btn btn--secondary btn--fit', href: SPOTIFY_DASHBOARD_URL, target: '_blank', rel: 'noopener noreferrer' },
          h('span', {}, t('setup.step1.open')), icon('external')),
      ]),
      setupStep(2, t('setup.step2.title'), hasClientId, [
        h('p', { class: 'step__text' }, t('setup.step2.body')),
        clientIdForm(state, actions, 'setup'),
      ]),
      setupStep(3, t('setup.step3.title'), state.connected, state.connected ? connectedBody : connectBody)));
}

/* ---------- Game view (SPEC §4.2) ---------- */

function puckRing(descriptor) {
  const ring = svg('svg', { class: 'puck__ring', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
  ring.append(
    svg('circle', { class: 'ring-track', cx: 50, cy: 50, r: RING_RADIUS }),
    svg('circle', {
      class: 'ring-value',
      cx: 50,
      cy: 50,
      r: RING_RADIUS,
      'stroke-dasharray': RING_LENGTH.toFixed(2),
      'stroke-dashoffset': ringOffset(descriptor),
      'data-live': 'puck-ring',
    }),
  );
  return ring;
}

function puckButton(descriptor, actions) {
  const playing = descriptor.playing;
  return h('button', {
    type: 'button',
    class: `puck ${playing ? 'puck--playing' : 'puck--ready'} ${descriptor.busy ? 'is-busy' : ''}`,
    'aria-pressed': playing ? 'true' : 'false',
    'aria-label': t('game.playStopLabel'),
    'aria-busy': descriptor.busy ? 'true' : 'false',
    onclick: actions.playStop,
    'data-focus': 'puck',
  },
  puckRing(descriptor),
  h('span', { class: 'puck__icon' }, icon(playing ? 'stop' : 'play')),
  h('span', { class: 'puck__label' }, playing ? t('game.stop') : t('game.play')),
  h('span', { class: 'puck__time', 'data-live': 'puck-time' }, formatTime(descriptor.positionMs)));
}

function playlistSelect(state, actions, disabled) {
  return h('label', { class: 'select-field' },
    h('span', { class: 'sr-only' }, t('game.playlist')),
    h('select', {
      class: 'select',
      disabled,
      'data-focus': 'playlist-select',
      onchange: (event) => actions.setActivePlaylist(event.target.value),
    }, state.playlists.map((playlist) => h('option', {
      value: playlist.id,
      selected: playlist.id === state.settings.activePlaylistId,
    }, playlist.name))),
    icon('down', 'icon icon--sm select-field__icon'));
}

function nowCard(descriptor) {
  return h('div', { class: 'now' },
    cover(descriptor.track, 'now__cover'),
    h('div', { class: 'now__text' },
      h('p', { class: 'now__title' }, descriptor.track.name),
      h('p', { class: 'now__artist' }, artistsText(descriptor.track)),
      h('p', { class: 'now__status', 'data-live': 'now-status' }, statusText(descriptor))));
}

function transport(descriptor, actions) {
  return h('div', { class: 'transport' },
    button({ label: t('game.previous'), iconName: 'prev', variant: 'secondary', onClick: actions.prev, disabled: descriptor.busy, focusKey: 'prev', hideLabelOnMobile: true, ariaLabel: t('game.previous') }),
    h('p', { class: 'transport__then' },
      h('span', { class: 'muted' }, t('game.then')), ' ',
      h('span', { class: 'transport__then-title' }, descriptor.thenTrack.name)),
    button({ label: t('game.next'), iconName: 'next', variant: 'secondary', onClick: actions.next, disabled: descriptor.busy, focusKey: 'next', hideLabelOnMobile: true, ariaLabel: t('game.next') }));
}

/** The tracks in play order: the shuffled order in shuffle mode (R-13). */
function queueList(descriptor, actions) {
  return h('ol', { class: 'queue' }, descriptor.queue.map((index, position) => {
    const track = descriptor.playlist.tracks[index];
    const current = index === descriptor.index;
    return h('li', {},
      h('button', {
        type: 'button',
        class: `queue__item ${current ? 'is-current' : ''}`,
        'aria-current': current ? 'true' : null,
        disabled: descriptor.busy,
        onclick: () => actions.selectTrack(index),
        'data-focus': `queue-${track.id}`,
      },
      h('span', { class: 'queue__num' }, String(position + 1)),
      cover(track, 'queue__cover'),
      h('span', { class: 'queue__text' },
        h('span', { class: 'queue__title' }, track.name),
        h('span', { class: 'queue__artist' }, artistsText(track))),
      h('span', { class: 'queue__start' }, timeRange(track))));
  }));
}

function renderGame(state, actions) {
  const descriptor = actions.describeGame();
  const active = state.playlists.find((playlist) => playlist.id === state.settings.activePlaylistId);

  if (!state.playlists.length) {
    return h('section', { class: 'page' },
      h('h1', { class: 'sr-only' }, t('nav.game')),
      emptyState(t('game.empty.noPlaylistsTitle'), t('game.empty.noPlaylistsBody'), [
        button({ label: t('playlists.new'), iconName: 'plus', variant: 'primary', onClick: actions.createPlaylist }),
      ]));
  }

  const toolbar = h('div', { class: 'game__toolbar' },
    playlistSelect(state, actions, Boolean(descriptor?.playing || descriptor?.busy)));

  if (!descriptor) {
    return h('section', { class: 'page' },
      h('h1', { class: 'sr-only' }, t('nav.game')),
      toolbar,
      emptyState(t('game.empty.noSongsTitle'), t('game.empty.noSongsBody'), [
        active ? button({ label: t('game.empty.addSongs'), iconName: 'plus', variant: 'primary', onClick: () => actions.openPlaylist(active.id) }) : null,
      ]));
  }

  return h('section', { class: `game ${descriptor.playing ? 'is-playing' : ''}` },
    h('h1', { class: 'sr-only' }, t('nav.game')),
    h('div', { class: 'game__main' },
      toolbar,
      h('div', { class: 'stage' }, puckButton(descriptor, actions)),
      nowCard(descriptor),
      transport(descriptor, actions)),
    h('section', { class: 'game__queue panel', 'aria-labelledby': 'queue-title' },
      h('div', { class: 'panel__head' },
        h('h2', { class: 'panel__title', id: 'queue-title' }, t('game.queue')),
        h('span', { class: 'panel__meta' }, tn('count.songs', descriptor.playlist.tracks.length))),
      queueList(descriptor, actions)));
}

/* ---------- Playlists view (SPEC §4.3, §4.4) ---------- */

function emptyState(title, body, buttons) {
  return h('div', { class: 'empty' },
    logoMark('logo--empty'),
    h('h2', { class: 'empty__title' }, title),
    h('p', { class: 'empty__body' }, body),
    h('div', { class: 'empty__actions' }, buttons));
}

function renderPlaylistList(state, actions) {
  const head = h('div', { class: 'page__head' },
    h('h1', { class: 'page__title display' }, t('playlists.title')),
    h('div', { class: 'page__actions' },
      button({ label: t('playlists.import'), iconName: 'upload', variant: 'ghost', onClick: actions.importFile, hideLabelOnMobile: true, ariaLabel: t('playlists.import') }),
      state.playlists.length ? button({ label: t('playlists.exportAll'), iconName: 'download', variant: 'ghost', onClick: actions.exportAll, hideLabelOnMobile: true, ariaLabel: t('playlists.exportAll') }) : null,
      button({ label: t('playlists.new'), iconName: 'plus', variant: 'primary', onClick: actions.createPlaylist, focusKey: 'new-playlist' })));

  if (!state.playlists.length) {
    return h('section', { class: 'page' }, head,
      emptyState(t('playlists.emptyTitle'), t('playlists.emptyBody'), [
        button({ label: t('playlists.createFirst'), iconName: 'plus', variant: 'primary', onClick: actions.createPlaylist }),
        button({ label: t('playlists.import'), iconName: 'upload', variant: 'secondary', onClick: actions.importFile }),
      ]));
  }

  return h('section', { class: 'page' }, head,
    h('ul', { class: 'plist' }, state.playlists.map((playlist) => {
      const isActive = playlist.id === state.settings.activePlaylistId;
      return h('li', {},
        h('button', { type: 'button', class: 'plist__item', onclick: () => actions.openPlaylist(playlist.id), 'data-focus': `plist-${playlist.id}` },
          cover(playlist.tracks[0], 'plist__art'),
          h('span', { class: 'plist__text' },
            h('span', { class: 'plist__name' }, playlist.name),
            h('span', { class: 'plist__meta' }, tn('count.songs', playlist.tracks.length))),
          isActive ? h('span', { class: 'badge' }, t('playlists.active')) : h('span', {}),
          icon('chevron', 'icon plist__chevron')));
    })));
}

function searchResultItems(playlist, state, actions) {
  const search = state.search;
  const nodes = [];
  if (search.error) nodes.push(h('p', { class: 'hint hint--error' }, icon('alert'), h('span', {}, search.error)));
  if (search.results.length) {
    const inPlaylist = new Set(playlist.tracks.map((track) => track.id));
    nodes.push(h('ul', { class: 'results' }, search.results.map((track) => {
      const added = inPlaylist.has(track.id);
      return h('li', { class: 'result' },
        cover(track, 'result__cover'),
        h('span', { class: 'result__text' },
          h('span', { class: 'result__title' }, track.name),
          h('span', { class: 'result__artist' }, artistsText(track))),
        h('span', { class: 'result__duration' }, formatTime(track.durationMs)),
        h('button', {
          type: 'button',
          class: `btn btn--icon ${added ? 'btn--ghost is-added' : 'btn--secondary'}`,
          disabled: added,
          'aria-label': added ? t('editor.alreadyAdded', { name: track.name }) : t('editor.addSong', { name: track.name }),
          onclick: () => actions.addTrack(track),
          'data-focus': `add-${track.id}`,
        }, icon(added ? 'check' : 'plus')));
    })));
  }
  if (search.loading) {
    nodes.push(h('p', { class: 'hint hint--box' }, spinner(), h('span', {}, t('editor.searching'))));
  } else if (search.hasMore) {
    nodes.push(button({ label: t('editor.loadMore'), variant: 'ghost', extraClass: 'btn--block', onClick: actions.searchMore, focusKey: 'load-more' }));
  } else if (search.done && !search.results.length && !search.error) {
    nodes.push(h('p', { class: 'hint hint--box' }, icon('info'), h('span', {}, t('editor.noResults'))));
  }
  return nodes;
}

function searchPanel(playlist, state, actions) {
  return h('div', { class: 'search panel' },
    h('label', { class: 'panel__title', for: 'search-input' }, t('editor.addSongs')),
    button({
      label: state.spotifyImporting ? t('spotifyImport.importing') : t('spotifyImport.open'),
      iconName: 'list',
      variant: 'secondary',
      extraClass: 'btn--fit',
      onClick: actions.importSpotifyPlaylist,
      disabled: state.spotifyImporting,
      focusKey: 'spotify-import',
    }),
    h('div', { class: 'search__box' },
      icon('search', 'icon search__icon'),
      h('input', {
        id: 'search-input',
        class: 'input search__input',
        type: 'search',
        value: state.search.query,
        placeholder: t('editor.searchPlaceholder'),
        autocomplete: 'off',
        enterkeyhint: 'search',
        'data-focus': 'search',
        oninput: (event) => actions.searchInput(event.target.value),
        onkeydown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            actions.searchNow();
          }
        },
      })),
    h('div', { id: 'search-results', class: 'search__results', 'aria-live': 'polite' }, searchResultItems(playlist, state, actions)));
}

/** Re-renders only the search results, so the search field keeps focus while typing. */
export function updateSearchResults(state, actions) {
  const container = document.getElementById('search-results');
  const playlist = state.playlists.find((candidate) => candidate.id === state.editingPlaylistId);
  if (container && playlist) container.replaceChildren(...searchResultItems(playlist, state, actions));
}

function trackPanel(playlist, track, index, previewing, state, actions) {
  const busy = state.playback.busy;
  const key = track.id;
  return h('div', { class: 'track__panel' },
    h('div', { class: 'track__row' },
      button({
        label: previewing ? t('editor.stopPreview') : t('editor.preview'),
        iconName: previewing ? 'stop' : 'play',
        variant: previewing ? 'danger' : 'secondary',
        onClick: () => actions.previewToggle(playlist.id, index),
        disabled: busy,
        focusKey: `preview-${key}`,
      }),
      previewing ? h('span', { class: 'track__live', 'data-live': 'preview-time', 'aria-label': t('editor.position') }, formatTime(actions.previewPosition())) : null),
    previewing ? null : h('p', { class: 'hint' }, t('editor.markHint')),
    markRow(playlist, track, index, 'start', previewing && !busy, actions),
    markRow(playlist, track, index, 'end', previewing && !busy, actions),
    h('div', { class: 'track__row track__manage' },
      h('div', { class: 'track__move' },
        button({ iconName: 'up', variant: 'ghost', extraClass: 'btn--icon', ariaLabel: t('editor.moveUp'), onClick: () => actions.moveTrack(playlist.id, index, -1), disabled: index === 0, focusKey: `up-${key}` }),
        button({ iconName: 'down', variant: 'ghost', extraClass: 'btn--icon', ariaLabel: t('editor.moveDown'), onClick: () => actions.moveTrack(playlist.id, index, 1), disabled: index === playlist.tracks.length - 1, focusKey: `down-${key}` })),
      h('span', { class: 'track__duration' }, t('editor.duration', { time: formatTime(track.durationMs) })),
      button({ label: t('editor.remove'), iconName: 'trash', variant: 'ghost', extraClass: 'btn--danger-text', onClick: () => actions.removeTrack(playlist.id, index), focusKey: `remove-${key}` })));
}

/** Start or end of a track: a time field and its "Mark" button (P-4, P-10). */
function markRow(playlist, track, index, which, canMark, actions) {
  const isEnd = which === 'end';
  const key = `${which}-${track.id}`;
  return h('div', { class: 'track__row track__mark' },
    h('label', { class: 'field__label track__mark-label', for: `input-${key}` }, t(isEnd ? 'editor.endLabel' : 'editor.startLabel')),
    h('input', {
      id: `input-${key}`,
      class: 'input nudge__input',
      value: isEnd ? (track.endMs == null ? '' : formatTime(track.endMs)) : formatTime(track.startMs),
      placeholder: isEnd ? formatTime(track.durationMs) : null,
      autocomplete: 'off',
      'data-focus': key,
      onchange: (event) => (isEnd ? actions.setEnd : actions.setStart)(playlist.id, index, event.target.value),
      onkeydown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.target.blur();
        }
      },
    }),
    // Always rendered so both rows line up; hidden when there is nothing to clear.
    button({
      iconName: 'close',
      variant: 'ghost',
      extraClass: `btn--icon ${(isEnd ? track.endMs != null : track.startMs > 0) ? '' : 'is-hidden'}`,
      ariaLabel: t(isEnd ? 'editor.clearEnd' : 'editor.clearStart'),
      onClick: () => (isEnd ? actions.clearEnd : actions.clearStart)(playlist.id, index),
      focusKey: `clear-${key}`,
    }),
    button({
      label: t(isEnd ? 'editor.markEnd' : 'editor.markStart'),
      iconName: 'flag',
      variant: 'primary',
      extraClass: 'track__mark-btn',
      onClick: () => actions.markHere(playlist.id, index, which),
      disabled: !canMark,
      focusKey: `mark-${key}`,
    }));
}

function trackRow(playlist, track, index, state, actions) {
  const expanded = state.expandedTrack === index;
  const playback = state.playback;
  const previewing = playback.mode === 'preview' && playback.status === 'playing'
    && playback.previewKey?.playlistId === playlist.id && playback.previewKey?.index === index;
  return h('li', { class: `track ${expanded ? 'is-open' : ''} ${previewing ? 'is-previewing' : ''}` },
    h('button', {
      type: 'button',
      class: 'track__summary',
      'aria-expanded': expanded ? 'true' : 'false',
      onclick: () => actions.toggleTrack(index),
      'data-focus': `track-${track.id}`,
    },
    h('span', { class: 'track__num' }, String(index + 1)),
    cover(track, 'track__cover'),
    h('span', { class: 'track__text' },
      h('span', { class: 'track__title' }, track.name),
      h('span', { class: 'track__artist' }, artistsText(track))),
    h('span', { class: 'track__start' }, timeRange(track)),
    icon(expanded ? 'up' : 'down', 'icon icon--sm track__toggle')),
    expanded ? trackPanel(playlist, track, index, previewing, state, actions) : null);
}

function renderEditor(playlist, state, actions) {
  return h('section', { class: 'page editor' },
    h('div', { class: 'editor__nav' },
      button({ label: t('editor.back'), iconName: 'back', variant: 'ghost', extraClass: 'btn--sm btn--back', onClick: actions.closePlaylist, focusKey: 'editor-back' })),
    h('div', { class: 'page__head' },
      h('div', { class: 'page__titles' },
        h('h1', { class: 'page__title display' }, playlist.name),
        h('p', { class: 'page__sub' }, tn('count.songs', playlist.tracks.length))),
      h('div', { class: 'page__actions' },
        button({ label: t('editor.rename'), iconName: 'edit', variant: 'ghost', onClick: () => actions.renamePlaylist(playlist.id), hideLabelOnMobile: true, ariaLabel: t('editor.rename') }),
        button({ label: t('editor.duplicate'), iconName: 'duplicate', variant: 'ghost', onClick: () => actions.duplicatePlaylist(playlist.id), hideLabelOnMobile: true, ariaLabel: t('editor.duplicate') }),
        button({ label: t('editor.export'), iconName: 'download', variant: 'ghost', onClick: () => actions.exportPlaylist(playlist.id), hideLabelOnMobile: true, ariaLabel: t('editor.export') }),
        button({ label: t('editor.delete'), iconName: 'trash', variant: 'ghost', extraClass: 'btn--danger-text', onClick: () => actions.deletePlaylist(playlist.id), hideLabelOnMobile: true, ariaLabel: t('editor.delete') }))),
    h('div', { class: 'editor__grid' },
      searchPanel(playlist, state, actions),
      h('section', { class: 'editor__songs', 'aria-labelledby': 'songs-title' },
        h('h2', { class: 'section-title', id: 'songs-title' }, t('editor.songs')),
        playlist.tracks.length
          ? h('ol', { class: 'tracks' }, playlist.tracks.map((track, index) => trackRow(playlist, track, index, state, actions)))
          : h('p', { class: 'hint hint--box' }, icon('info'), h('span', {}, t('editor.noSongs'))))));
}

function renderPlaylists(state, actions) {
  const playlist = state.playlists.find((candidate) => candidate.id === state.editingPlaylistId);
  return playlist ? renderEditor(playlist, state, actions) : renderPlaylistList(state, actions);
}

/* ---------- Settings view (SPEC §4.5) ---------- */

function segmented(name, legend, options, current, onChange) {
  return h('fieldset', { class: 'segmented' },
    h('legend', { class: 'field__label' }, legend),
    h('div', { class: 'segmented__opts' }, options.map(([value, label]) => h('label', { class: 'segmented__opt' },
      h('input', {
        type: 'radio',
        name,
        value,
        checked: value === current,
        onchange: () => onChange(value),
        'data-focus': `${name}-${value}`,
      }),
      h('span', {}, label)))));
}

function advanceNudge(which, delta, actions) {
  const seconds = Math.abs(delta / 1000);
  return h('button', {
    type: 'button',
    class: 'btn btn--secondary nudge__btn',
    'aria-label': t(delta < 0 ? 'settings.nudgeLess' : 'settings.nudgeMore', { seconds }),
    onclick: () => actions.nudgeAdvance(which, delta),
    'data-focus': `advance-${which}-${delta}`,
  }, delta < 0 ? `−${seconds}` : `+${seconds}`);
}

/** One R-2 threshold with nudge buttons and an m:ss input (S-8). */
function advanceField(which, labelKey, actions) {
  const labelId = `advance-${which}-label`;
  return h('div', { class: 'field' },
    h('span', { class: 'field__label', id: labelId }, t(labelKey)),
    h('div', { class: 'nudge', role: 'group', 'aria-labelledby': labelId },
      advanceNudge(which, -ADVANCE_NUDGE_MS, actions),
      h('input', {
        class: 'input nudge__input',
        value: formatTime(actions.advanceValue(which).ms),
        'aria-labelledby': labelId,
        autocomplete: 'off',
        'data-focus': `advance-${which}`,
        onchange: (event) => actions.setAdvance(which, event.target.value),
        onkeydown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.target.blur();
          }
        },
      }),
      advanceNudge(which, ADVANCE_NUDGE_MS, actions)));
}

function advanceGroup(state, actions) {
  const played = actions.advanceValue('played');
  const idle = actions.advanceValue('idle');
  const isDefault = played.ms === played.defaultMs && idle.ms === idle.defaultMs;
  return settingsGroup(t('settings.advance'), [
    segmented('order', t('settings.order'), [['shuffle', t('settings.orderShuffle')], ['playlist', t('settings.orderPlaylist')]],
      state.settings.shuffle ? 'shuffle' : 'playlist', (value) => actions.setShuffle(value === 'shuffle')),
    h('p', { class: 'hint' }, t(state.settings.shuffle ? 'settings.orderShuffleHelp' : 'settings.orderPlaylistHelp')),
    h('p', { class: 'hint' }, t('settings.advanceHelp')),
    advanceField('played', 'settings.advancePlayed', actions),
    advanceField('idle', 'settings.advanceIdle', actions),
    button({
      label: t('settings.advanceReset', { played: formatTime(played.defaultMs), idle: formatTime(idle.defaultMs) }),
      iconName: 'refresh',
      variant: 'ghost',
      extraClass: 'btn--fit',
      onClick: actions.resetAdvance,
      disabled: isDefault,
      focusKey: 'advance-reset',
    }),
  ]);
}

function settingsGroup(title, children) {
  return h('section', { class: 'settings-group panel' }, h('h2', { class: 'panel__title' }, title), children);
}

function renderSettings(state, actions) {
  const auto = t('settings.auto');
  let status = t('settings.notConnected');
  if (state.connected) status = state.profile ? t('settings.connectedAs', { name: state.profile.name }) : t('settings.connected');

  return h('section', { class: 'page settings' },
    h('div', { class: 'page__head' }, h('h1', { class: 'page__title display' }, t('settings.title'))),
    h('div', { class: 'settings__grid' },
      settingsGroup(t('settings.display'), [
        segmented('language', t('settings.language'), [['auto', auto], ['en', 'English'], ['fr', 'Français']],
          state.settings.language || 'auto', (value) => actions.setLanguage(value === 'auto' ? null : value)),
        segmented('theme', t('settings.theme'), [['auto', auto], ['light', t('settings.light')], ['dark', t('settings.dark')]],
          state.settings.theme || 'auto', (value) => actions.setTheme(value === 'auto' ? null : value)),
      ]),
      settingsGroup(t('settings.spotify'), [
        h('p', { class: 'status-line' }, h('span', { class: `status-dot ${state.connected ? 'is-on' : ''}`, 'aria-hidden': 'true' }), h('span', {}, status)),
        clientIdForm(state, actions, 'settings'),
        h('div', { class: 'field' },
          h('label', { class: 'field__label', for: 'redirect-uri-settings' }, t('setup.redirectLabel')),
          copyField('redirect-uri-settings', state.redirectUri, actions)),
        state.connected ? button({ label: t('settings.disconnect'), iconName: 'logout', variant: 'ghost', extraClass: 'btn--danger-text btn--fit', onClick: actions.disconnect }) : null,
      ]),
      settingsGroup(t('settings.device'), [
        h('p', { class: 'hint' }, devicesHelp(state)),
        deviceList(state, actions),
      ]),
      advanceGroup(state, actions),
      settingsGroup(t('settings.data'), [
        h('p', { class: 'hint' }, t('settings.dataHelp')),
        h('div', { class: 'button-row' },
          button({ label: t('playlists.exportAll'), iconName: 'download', variant: 'secondary', onClick: actions.exportAll, disabled: !state.playlists.length }),
          button({ label: t('playlists.import'), iconName: 'upload', variant: 'secondary', onClick: actions.importFile })),
        button({ label: t('settings.reset'), iconName: 'trash', variant: 'ghost', extraClass: 'btn--danger-text btn--fit', onClick: actions.resetAll }),
      ]),
      settingsGroup(t('settings.about'), [
        h('p', { class: 'about__version' }, t('settings.version', { version: state.appVersion })),
        h('p', { class: 'hint' }, t('settings.personalUse')),
      ])));
}

/* ---------- App shell ---------- */

function renderView(state, actions) {
  switch (state.view) {
    case 'game': return renderGame(state, actions);
    case 'playlists': return renderPlaylists(state, actions);
    case 'settings': return renderSettings(state, actions);
    default: return renderSetup(state, actions);
  }
}

/** Banner shown when a newer version is deployed while the app is open (U-2). */
function updateBanner(state, actions) {
  return h('div', { class: 'update-banner', role: 'status' },
    h('span', { class: 'update-banner__text' }, t('update.available', { version: state.updateVersion })),
    button({ label: t('update.reload'), iconName: 'refresh', variant: 'primary', extraClass: 'btn--sm', onClick: actions.reloadApp, focusKey: 'update-reload' }));
}

/** Renders the whole app and restores keyboard focus to the same control. */
export function renderApp(root, state, actions) {
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement && root.contains(active) ? active.dataset.focus : null;

  const children = [
    renderHeader(state, actions),
    state.updateVersion ? updateBanner(state, actions) : null,
    h('main', { class: `main main--${state.view}`, id: 'main' }, renderView(state, actions)),
  ];
  if (state.connected) children.push(renderNav(state, actions, 'bottom'));
  root.replaceChildren(...children);

  if (focusKey) {
    const target = root.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.type !== 'radio') {
        const end = target.value.length;
        try { target.setSelectionRange(end, end); } catch { /* Not a text input. */ }
      }
    }
  }
}

/** Shows a full-screen message, used while finishing the Spotify login. */
export function renderSplash(root, message) {
  root.replaceChildren(h('div', { class: 'splash' }, logoMark('logo--hero'), spinner(), h('p', {}, message)));
}

/** Updates the live parts of the Game screen without re-rendering it. */
export function updateLive(root, descriptor) {
  if (!descriptor) return;
  const time = root.querySelector('[data-live="puck-time"]');
  if (time) time.textContent = formatTime(descriptor.positionMs);
  const ring = root.querySelector('[data-live="puck-ring"]');
  if (ring) ring.setAttribute('stroke-dashoffset', ringOffset(descriptor));
  const status = root.querySelector('[data-live="now-status"]');
  if (status) status.textContent = statusText(descriptor);
}

/** Updates the preview position in the playlist editor. */
export function updatePreviewTime(root, positionMs) {
  const element = root.querySelector('[data-live="preview-time"]');
  if (element) element.textContent = formatTime(positionMs);
}

/** Scrolls the queue panel (not the page) so the current track stays visible on wide screens. */
export function keepCurrentInView(root) {
  const list = root.querySelector('.queue');
  const item = root.querySelector('.queue__item.is-current');
  if (!list || !item || list.scrollHeight <= list.clientHeight) return;
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = Math.max(0, top - list.clientHeight / 3);
  }
}

/* ---------- Toasts ---------- */

/** Shows a short message. Types: "info", "success", "error". */
export function toast(message, type = 'info') {
  const region = document.getElementById('toasts');
  if (!region) return;
  const iconName = { error: 'alert', success: 'check' }[type] || 'info';
  const element = h('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(iconName), h('span', {}, message));
  region.append(element);
  while (region.children.length > 2) region.firstElementChild.remove();
  setTimeout(() => {
    element.classList.add('is-leaving');
    setTimeout(() => element.remove(), TOAST_EXIT_MS);
  }, type === 'error' ? ERROR_TOAST_DURATION_MS : TOAST_DURATION_MS);
}

/* ---------- Dialogs ---------- */

let dialogCount = 0;

/**
 * Opens a modal dialog. Each action has a label and either a `value` or an
 * `onSelect` function; returning undefined from onSelect keeps the dialog open.
 * Resolves with the chosen value, or null when dismissed.
 */
/**
 * Opens a modal dialog. Resolves with the value of the chosen action, or null when dismissed.
 * `body` can be a function that receives `finish(value)` to close the dialog from its content.
 */
export function openDialog({ title, body = [], actions = [], initialFocus = null }) {
  return new Promise((resolve) => {
    dialogCount += 1;
    const titleId = `dialog-title-${dialogCount}`;
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': titleId });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (dialog.open) dialog.close();
    };
    const buttons = actions.map((action) => h('button', {
      type: 'button',
      class: `btn ${action.className || 'btn--secondary'}`,
      onclick: () => {
        const value = action.onSelect ? action.onSelect() : action.value;
        if (value !== undefined) finish(value);
      },
    }, action.label));
    dialog.append(h('div', { class: 'dialog__inner' },
      h('h2', { class: 'dialog__title', id: titleId }, title),
      typeof body === 'function' ? body(finish) : body,
      h('div', { class: 'dialog__actions' }, buttons)));
    dialog.addEventListener('close', () => {
      finish(null);
      dialog.remove();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null);
    });
    document.body.append(dialog);
    dialog.showModal();
    (initialFocus || buttons[buttons.length - 1])?.focus();
  });
}

/** Asks for confirmation. Resolves true or false. */
export async function confirmDialog({ title, message, confirmLabel, danger = false }) {
  const value = await openDialog({
    title,
    body: h('p', { class: 'dialog__text' }, message),
    actions: [
      { label: t('common.cancel'), value: false, className: 'btn--ghost' },
      { label: confirmLabel, value: true, className: danger ? 'btn--danger' : 'btn--primary' },
    ],
  });
  return value === true;
}

function submitOnEnter(input, getDialogButton) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      getDialogButton()?.click();
    }
  });
}

/** Asks for a short text. Resolves the trimmed text, or null. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel }) {
  const input = h('input', { class: 'input', value, placeholder, maxlength: 80, autocomplete: 'off', 'aria-label': label });
  submitOnEnter(input, () => input.closest('dialog')?.querySelector('.dialog__actions .btn:last-child'));
  return openDialog({
    title,
    body: h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), input),
    initialFocus: input,
    actions: [
      { label: t('common.cancel'), value: null, className: 'btn--ghost' },
      {
        label: confirmLabel,
        className: 'btn--primary',
        onSelect: () => {
          const text = input.value.trim();
          if (text) return text;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return undefined;
        },
      },
    ],
  });
}

/** Asks the user to type a word to confirm a destructive action (S-5). */
export async function typedConfirmDialog({ title, message, word, confirmLabel }) {
  const input = h('input', { class: 'input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t('settings.resetType', { word }) });
  submitOnEnter(input, () => input.closest('dialog')?.querySelector('.dialog__actions .btn:last-child'));
  const value = await openDialog({
    title,
    body: [
      h('p', { class: 'dialog__text' }, message),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, t('settings.resetType', { word })), input),
    ],
    initialFocus: input,
    actions: [
      { label: t('common.cancel'), value: false, className: 'btn--ghost' },
      {
        label: confirmLabel,
        className: 'btn--danger',
        onSelect: () => {
          if (input.value.trim().toLowerCase() === word.toLowerCase()) return true;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return undefined;
        },
      },
    ],
  });
  return value === true;
}

let devicePickerBody = null;

/** Opens the device picker dialog (F-4, S-3). */
export function openDevicePicker(state, actions) {
  if (devicePickerBody?.isConnected) return;
  devicePickerBody = h('div', { class: 'device-dialog' }, deviceList(state, actions));
  openDialog({
    title: t('devices.title'),
    body: [h('p', { class: 'dialog__text' }, devicesHelp(state)), devicePickerBody],
    actions: [{ label: t('common.done'), value: true, className: 'btn--primary' }],
  }).then(() => {
    devicePickerBody = null;
  });
}

/**
 * Opens the Spotify playlist picker (P-9) in a loading state.
 * Returns `{ result, show(playlists), fail(message), close() }`; `result` resolves with the chosen playlist or null.
 */
export function openSpotifyPlaylistPicker() {
  const content = h('div', { class: 'import-picker', 'aria-live': 'polite' },
    h('p', { class: 'hint hint--box' }, spinner(), h('span', {}, t('spotifyImport.loading'))));
  let choose = () => {};
  let close = () => {};
  const result = openDialog({
    title: t('spotifyImport.title'),
    body: (finish) => {
      choose = finish;
      close = () => finish(null);
      return [h('p', { class: 'dialog__text' }, t('spotifyImport.help')), content];
    },
    actions: [{ label: t('common.cancel'), value: null, className: 'btn--ghost' }],
  });
  return {
    result,
    show(playlists) {
      if (!content.isConnected) return;
      if (!playlists.length) {
        content.replaceChildren(h('p', { class: 'hint hint--box' }, icon('info'), h('span', {}, t('spotifyImport.none'))));
        return;
      }
      content.replaceChildren(h('ul', { class: 'import-list' }, playlists.map((playlist, index) => h('li', {},
        h('button', {
          type: 'button',
          class: 'import-item',
          onclick: () => choose(playlist),
          'data-autofocus': index === 0 ? 'true' : null,
        },
        cover(playlist, 'import-item__cover'),
        h('span', { class: 'import-item__text' },
          h('span', { class: 'import-item__name' }, playlist.name),
          h('span', { class: 'import-item__count' }, tn('count.songs', playlist.total))),
        icon('chevron', 'icon icon--sm'))))));
      content.querySelector('[data-autofocus]')?.focus();
    },
    fail(message) {
      if (content.isConnected) content.replaceChildren(h('p', { class: 'hint hint--error' }, icon('alert'), h('span', {}, message)));
    },
    close: () => close(),
  };
}

/** Refreshes the device list inside the open device dialog, if any. */
export function refreshDevicePickers(state, actions) {
  if (devicePickerBody?.isConnected) devicePickerBody.replaceChildren(deviceList(state, actions));
}

/* ---------- Files ---------- */

/** Opens the file chooser. Resolves the chosen File, or null. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'sr-only', tabindex: '-1' });
    const done = (file) => {
      resolve(file);
      input.remove();
    };
    input.addEventListener('change', () => done(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

/** Saves text as a downloaded file. */
export function downloadFile(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = h('a', { href: url, download: filename, class: 'sr-only' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
