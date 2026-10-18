# Hockey DJ — Specification

| | |
|---|---|
| **Version** | 0.8 |
| **Last updated** | 2026-10-18 |
| **Live URL** | https://north-lab-kev.github.io/hockey-dj/ |

> This document defines **what** Hockey DJ does and **why**. It is the source of truth for requirements and technical decisions, and changes to it are recorded in the [Changelog](#12-changelog).
> How to work on the project (conventions, procedures, current status) is covered in [`CLAUDE.md`](CLAUDE.md). The user guide is in [`README.md`](README.md).

---

## 1. Purpose

Hockey DJ is a web app for playing music in a hockey arena during stoppages of play. At each stoppage, the operator taps one big button to start a song at its most energetic moment (e.g. the chorus). When play resumes, the operator taps the same button to stop it.

- **Music source:** the operator's Spotify Premium account.
- **Users:** single user. There are no user accounts in the app.
- **Use:** personal, non-commercial use only.

## 2. Non-functional requirements

| ID | Requirement |
|---|---|
| NF-1 | Runs in any modern browser on Windows, Android, iOS/iPadOS, tablets and phones. |
| NF-2 | Nothing to install. "Add to Home Screen" is optional (Phase 2). |
| NF-3 | No backend and no database. Static files only, hosted for free on GitHub Pages from a public repository, published from the `main` branch root. |
| NF-4 | All user data is stored locally in the browser (localStorage). Nothing is sent anywhere except Spotify. |
| NF-5 | Responsive and mobile-first. Must be fully usable one-handed on a phone in portrait mode. |
| NF-6 | Bilingual UI: English and French, with a language selector. The default language is detected from the browser. |
| NF-7 | Plain HTML, CSS and JavaScript (native ES modules). No framework, no npm, no build step. |
| NF-8 | No third-party runtime dependencies. Exception: the Spotify Web Playback SDK script (Phase 2). |
| NF-9 | Everything in the repository is written in English: code, comments, docs and commit messages. |
| NF-10 | Files are kept flat at the repository root, because they are uploaded through the GitHub web UI. |

## 3. Spotify integration

### 3.1 Spotify app registration

- **Dashboard:** https://developer.spotify.com/dashboard. The app is named "Hockey DJ" and runs in **Development Mode**.
- **Redirect URI (production):** `https://north-lab-kev.github.io/hockey-dj/`. It must match exactly, including the trailing slash.
- **Redirect URI (local development):** `http://127.0.0.1:8000/`. Only loopback IPs are allowed over HTTP, and `localhost` is rejected.
- **APIs enabled:** Web API and Web Playback SDK.
- **Client ID:** entered by the user in the app and stored locally. It is never hard-coded or committed.
- **Client Secret:** never used and never stored anywhere.

**Development Mode constraints (as of the February 2026 changes):**
- The app owner must have an active Premium subscription.
- At most 5 allow-listed users. Not an issue, since the app is single user.
- Only a restricted set of endpoints is available.
- Search returns at most 10 results per request.
- Spotify may change these rules again; see §10.

### 3.2 Authentication

- **Flow:** Authorization Code with PKCE (S256). The implicit grant was removed by Spotify in November 2025.
- **Redirect URI:** computed at runtime as `location.origin + location.pathname`, with any trailing `index.html` removed. The same code therefore works in production and in local development. The setup screen displays this value with a Copy button so it can be registered in the dashboard.
- **Authorize:** `GET https://accounts.spotify.com/authorize`.
  - Parameters: `response_type=code`, `client_id`, `scope`, `redirect_uri`, `state`, `code_challenge_method=S256` and `code_challenge`.
  - Before redirecting, the code verifier and `state` are stored in localStorage under `hockeydj.pkce`.
- **Callback:** on load, if the URL contains `code` and `state`:
  1. Check that `state` matches the stored value.
  2. Exchange the code for tokens.
  3. Delete `hockeydj.pkce`.
  4. Clean the URL with `history.replaceState`.
- **Token exchange:** `POST https://accounts.spotify.com/api/token` (form-encoded) with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id` and `code_verifier`.
- **Refresh:** same endpoint with `grant_type=refresh_token`, `refresh_token` and `client_id`.
  - Refresh proactively 60 s before expiry, and also on a 401 response (retry the request once).
  - If the response contains a new refresh token, store it in place of the old one.
- **Scopes:**

  | Phase | Scopes |
  |---|---|
  | Phase 1 | `user-read-playback-state`, `user-modify-playback-state` |
  | Phase 2 | `playlist-read-private`, `playlist-read-collaborative` (playlist import); `streaming`, `user-read-email`, `user-read-private` (Web Playback SDK) |

  The granted scopes are stored. If the code requires scopes that were not granted, the app asks the user to reconnect.
- **Disconnect:** deletes the tokens. The Client ID and playlists are kept.

### 3.3 Endpoints used

All endpoints below are on Spotify's "Endpoints still available" list, checked on 2026-10-18 against the Web API changelog for February 2026: https://developer.spotify.com/documentation/web-api/references/changes/february-2026

| Purpose | Endpoint | Notes |
|---|---|---|
| Play a track from an offset | `PUT /v1/me/player/play?device_id={id}` | Body: `{"uris":["spotify:track:…"],"position_ms":45000}` |
| Stop | `PUT /v1/me/player/pause` | |
| List devices | `GET /v1/me/player/devices` | Device objects include `id`, `name`, `type`, `is_active` and `supports_volume` |
| Playback state and progress | `GET /v1/me/player` | Used for "Mark here" and for state sync while playing |
| Activate a device | `PUT /v1/me/player` | Body: `{"device_ids":["…"],"play":false}` |
| Fade-out (Phase 2) | `PUT /v1/me/player/volume?volume_percent=` | Only when `supports_volume` is true |
| Search tracks | `GET /v1/search?q=…&type=track&limit=10&offset=…` | Maximum `limit` is 10 |
| Resolve a pasted link | `GET /v1/tracks/{id}` | The batch `GET /tracks` was removed |
| Profile (display name) | `GET /v1/me` | `product`, `email` and `country` are no longer returned |
| Import playlist (Phase 2) | `GET /v1/me/playlists`, `GET /v1/playlists/{id}/items` | Contents are returned only for playlists the user owns or collaborates on. Field paths are `items.items[].item` |

**Do not use** (removed in Development Mode): `GET /tracks`, `GET /artists/{id}/top-tracks`, `GET /users/{id}`, `GET /users/{id}/playlists`, the `/playlists/{id}/tracks` endpoints (use `/items`), and the `popularity` fields.

### 3.4 Playback model

- **Primary mode: Spotify Connect remote control.** The app sends commands, and the Spotify app plays the audio on a target device. That device can be the same phone or tablet, or a computer connected to the arena's sound system. This works in every browser, iOS included.
  - **Requirement:** the Spotify app must be open on the target device.
- **Optional mode (Phase 2): Web Playback SDK.** On desktop browsers, the browser itself becomes a Spotify device. Mobile browsers are not a target for this mode, because of autoplay and background-playback limitations.
- **Device selection:** the selected device ID is saved. If that device is missing or inactive, the app activates it with Transfer Playback before playing.
- **Sync:** while the state is Playing and the page is visible, the app polls `GET /v1/me/player` every 5 s. Polling keeps the progress up to date and detects external changes.
  - **End-of-track handoff:** from the latest known progress, the app schedules the next track to start about 1 s before the current one ends (rule R-5 in §4.2.1). This avoids silence and keeps Spotify Autoplay from taking over.
  - **Fallback:** if a poll shows that playback stopped at (or within a few seconds of) the end of the track, or that a track other than ours is playing (for example, Spotify Autoplay), the app immediately starts the next track from its own playlist.
  - If a poll shows that playback was paused mid-track from the Spotify app, the app switches to Stopped exactly as if Stop had been pressed (R-1).
- **Error handling:**

  | Response | Handling |
  |---|---|
  | `401` | Refresh the token and retry once. |
  | `403` | Show "Spotify Premium required", or ask the user to add their email under User Management when Spotify reports the account is not registered for the app, or show the restriction message returned by Spotify. |
  | `404` with no active device | Show "Open Spotify on your device" and a device picker. |
  | `429` | Respect `Retry-After`. The `QUOTA_EXCEEDED` reason must show a clear message. |
  | Network error | Show an offline message and keep the UI responsive. |

## 4. Functional requirements

### 4.1 First launch and setup

| ID | Requirement |
|---|---|
| F-1 | On first launch, the language is auto-detected (see §4.6). |
| F-2 | The setup screen asks for the Spotify Client ID. It includes short instructions, a link to the Spotify dashboard, and the redirect URI to register, with a Copy button. |
| F-3 | A "Connect to Spotify" button starts the PKCE flow. |
| F-4 | After connecting, the app shows the user's display name and asks the user to pick a playback device, with a Refresh button. |
| F-5 | The app opens directly on the Game screen once a Client ID, valid tokens and at least one playlist exist. |

### 4.2 Game screen (main screen)

| ID | Requirement |
|---|---|
| G-1 | One **big Play/Stop button**. On a phone in portrait mode it takes at least about 40 % of the viewport height. Its state is shown by colour, icon and a text label (`PLAY` / `STOP`), never by colour alone. |
| G-2 | **Play** and **Stop** follow the rules in §4.2.1. |
| G-3 | Feedback is optimistic: the button changes state immediately and shows a small busy indicator. If the request fails, it reverts and shows an error toast. Taps made while a request is in flight are ignored. |
| G-4 | The screen shows the current track (cover, title, artist, start time), the next track, and what the next Play will do (R-9). |
| G-5 | Previous and Next buttons, and tapping a track in the list, select the current track (R-7). |
| G-6 | A playlist selector chooses the active playlist. It is disabled while game music plays. |
| G-7 | An indicator shows the selected device. A warning appears when no device is available. |
| G-8 | Keyboard shortcuts on desktop: `Space` = Play/Stop, `→` / `←` = next/previous track. |
| G-9 | The Screen Wake Lock API keeps the screen on while the Game screen is visible. It is re-acquired on `visibilitychange`, and silently skipped where unsupported. |

#### 4.2.1 Play/Stop logic

For the current track, the app keeps three values:
- `positionMs`: where playback was paused.
- `playedMs`: the **cumulative** time the track has actually played since it became the current track. It is measured locally, from each successful play request until Stop or a track change.
- `stoppedAt`: when Stop was last pressed.

| ID | Rule |
|---|---|
| R-1 | **Stop** pauses playback and saves `positionMs` and `stoppedAt`. It does not move the pointer. |
| R-2 | **Play after a Stop** advances to the next track and starts it at its `startMs` if **at least one** of these is true: (a) `playedMs ≥ 20 s`, meaning the current track has already played for at least 20 seconds in total; (b) `now − stoppedAt > 60 s`, meaning more than 1 minute has passed since Stop. |
| R-3 | Otherwise, **Play resumes** the current track at `positionMs`, like a pause. The app resumes by sending the track URI again with `position_ms`, never with a bare resume, so it cannot resume something else. |
| R-4 | Whenever the current track changes, `playedMs` resets to 0 and `positionMs` is set to the new track's `startMs`. |
| R-5 | **End of track:** when the current track ends while playing, the app immediately plays the next track of its playlist at that track's `startMs`. Playback continues down the list until Stop is pressed. |
| R-6 | The pointer wraps from the last track back to the first. |
| R-7 | **Explicit selection** (Previous, Next, or tapping a track): while Stopped, it only selects the track, and the next Play starts it at its `startMs`, bypassing R-2 and R-3. While Playing, the selected track starts immediately at its `startMs`. |
| R-8 | The thresholds are constants in `app.js`: `ADVANCE_AFTER_PLAYED_MS = 20000` and `ADVANCE_AFTER_IDLE_MS = 60000`. |
| R-9 | While Stopped, the Game screen always shows what the next Play will do: "Resume — {track} at m:ss" or "Next — {track}". When the 60 s idle window expires, the label updates by itself. |
| R-10 | The game state (`currentIndex`, `positionMs`, `playedMs`, `stoppedAt`) is saved, so a page reload keeps the user's place. Previews in the playlist editor never change the game state. Changing the active playlist resets the game state. |

### 4.3 Playlist management

| ID | Requirement |
|---|---|
| P-1 | Create, rename, duplicate and delete playlists. Deleting requires confirmation. |
| P-2 | Add tracks by searching (10 results per page, with a "Load more" button that uses `offset`) or by pasting a Spotify track link or URI. Accepted formats: `https://open.spotify.com/track/{id}`, `https://open.spotify.com/intl-xx/track/{id}`, either with an optional query string, and `spotify:track:{id}`. |
| P-3 | When a track is added, its metadata is stored with it: `id`, `uri`, `name`, `artists`, `imageUrl` and `durationMs`. The app never needs to re-fetch it. |
| P-4 | Each track has a start offset (`startMs`), shown as `m:ss`. It can be set in three ways: (a) typing `m:ss` or seconds; (b) nudge buttons −5 s, −1 s, +1 s, +5 s; (c) **Mark here**: while the track is previewing, this reads `progress_ms` from `GET /v1/me/player` and saves it as the start. |
| P-5 | **Preview** plays the track from its `startMs`. A Stop control is available. Preview is unavailable while game music plays, and it stops when the user leaves the editor. |
| P-6 | Tracks can be reordered (up/down buttons; drag-and-drop is optional) and removed. The track that is playing in the game cannot be removed, and the active playlist cannot be deleted while its music plays. |
| P-7 | Validation: `0 ≤ startMs < durationMs`. Out-of-range values are clamped and a warning is shown. |
| P-8 | Every change is saved immediately (autosave). There is no Save button. |
| P-9 | *(Phase 2)* Import a Spotify playlist the user owns or collaborates on. Imported tracks start with `startMs = 0`. |

### 4.4 Export and import

| ID | Requirement |
|---|---|
| E-1 | Export one playlist, or all playlists, as a JSON file named `hockey-dj-playlists-YYYY-MM-DD.json`. |
| E-2 | Exports contain playlists only. They never contain tokens or the Client ID. |
| E-3 | Import accepts a JSON file in the export format (§5.3). It validates the schema and adds the playlists. If a playlist ID already exists, the imported playlist gets a new ID and the suffix " (imported)". The app then reports how many playlists and tracks were imported. |
| E-4 | Unknown or newer `schemaVersion` values are rejected with a clear message. |

### 4.5 Settings

| ID | Requirement |
|---|---|
| S-1 | Language selector: Auto, English, Français. |
| S-2 | Spotify section: shows the Client ID (editable), the connection status with the display name, and a Disconnect button. |
| S-3 | Playback device picker, with a Refresh button. |
| S-4 | Export all and Import buttons. |
| S-5 | "Reset all data" with a typed confirmation. It clears every `hockeydj.*` key. |
| S-6 | An About section with the app version and a reminder that the app is for personal, non-commercial use. |
| S-7 | Theme selector: Auto (default, follows the device), Light, Dark. The choice is saved in `settings.theme` and applied immediately, without a reload (see §7). |

### 4.6 Internationalisation (i18n)

| ID | Requirement |
|---|---|
| I-1 | Supported languages are `en` and `fr`. All UI strings live in `i18n.js`. No user-facing text is hard-coded anywhere else. |
| I-2 | Default language: the app walks through `navigator.languages` (falling back to `[navigator.language]`). The first entry starting with `fr` gives `fr`, and the first starting with `en` gives `en`. If neither matches, it uses `en`. |
| I-3 | An explicit choice in the selector is saved (`settings.language`) and overrides detection. "Auto" clears it. |
| I-4 | Switching language re-renders the UI immediately, without a reload, and updates `<html lang>`. |
| I-5 | A compact EN / FR toggle is visible in the header on every screen. The same choice is in Settings. |
| I-6 | Strings support named parameters, for example `t('import.done', { playlists: 2, tracks: 31 })`. |

## 5. Data model

### 5.1 localStorage keys

All keys are prefixed with `hockeydj.`. Each value is JSON. Only `storage.js` reads or writes them.

| Key | Content |
|---|---|
| `hockeydj.settings` | `{ "language": "en" \| "fr" \| null, "theme": "light" \| "dark" \| null, "clientId": "…", "deviceId": "…", "activePlaylistId": "…" }` |
| `hockeydj.game` | `{ "currentIndex": 0, "positionMs": 45000, "playedMs": 12000, "stoppedAt": "2026-10-18T19:30:00.000Z" \| null }` (see R-10) |
| `hockeydj.auth` | `{ "accessToken": "…", "refreshToken": "…", "expiresAt": 1760000000000, "scopes": ["…"] }` |
| `hockeydj.playlists` | `{ "schemaVersion": 1, "playlists": [ Playlist, … ] }` |
| `hockeydj.pkce` | `{ "verifier": "…", "state": "…" }`. Temporary: exists only during the login redirect. |

### 5.2 Playlist object

```json
{
  "id": "6f1c2b1e-…",
  "name": "Game night",
  "createdAt": "2026-10-18T19:00:00.000Z",
  "updatedAt": "2026-10-18T19:05:00.000Z",
  "tracks": [
    {
      "id": "4uLU6hMCjMI75M1A2tKUQC",
      "uri": "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
      "name": "Track name",
      "artists": ["Artist"],
      "imageUrl": "https://i.scdn.co/image/…",
      "durationMs": 213000,
      "startMs": 45000
    }
  ]
}
```

IDs are generated with `crypto.randomUUID()`.

### 5.3 Export file

```json
{
  "app": "hockey-dj",
  "schemaVersion": 1,
  "exportedAt": "2026-10-18T19:10:00.000Z",
  "playlists": [ /* Playlist objects */ ]
}
```

### 5.4 Schema changes

Any change to the stored format increments `schemaVersion` and adds a migration function in `storage.js`. Migrations run on load.

## 6. Architecture and files

All files are at the repository root.

| File | Responsibility |
|---|---|
| `index.html` | Page shell, meta tags (viewport with `viewport-fit=cover`, theme colour), and loading `app.js` as a module. It also holds a tiny inline script in `<head>` that applies the saved theme before first paint, so a forced theme never flashes. This script is the only read of localStorage outside `storage.js`, and it is read-only. |
| `style.css` | All styles. Mobile-first, CSS custom properties, light and dark themes. |
| `app.js` | Bootstrap, OAuth callback handling, view routing (Setup / Game / Playlists / Settings) and app state. |
| `spotify.js` | **The only module that talks to Spotify:** PKCE auth, token refresh and every Web API call, with error mapping. |
| `storage.js` | **The only module that touches localStorage:** settings, auth, playlists, migrations, export and import. |
| `i18n.js` | Dictionaries (`en`, `fr`), language detection, `t()` and DOM translation helpers. |
| `ui.js` | Rendering of views and components, toasts and dialogs. |
| `manifest.json`, `icon.svg` | *(Phase 2)* Home-screen install. |
| `README.md` | Repository home page: overview, user setup guide, privacy notes, development quick start. |
| `SPEC.md` | This document. |
| `CLAUDE.md` | Guidance for AI-assisted development sessions. |

## 7. UX and visual design

- Mobile-first. Touch targets are at least 48 × 48 px. The Play/Stop button is the visual priority.
- Navigation uses a persistent bar for Game, Playlists and Settings: at the bottom on narrow screens, at the top or side on wide screens.
- **Theme:**
  - *Auto* (`settings.theme = null`) follows the device's light or dark setting through `prefers-color-scheme`, and switches live when the device changes.
  - *Light* and *Dark* force a theme regardless of the device (S-7).
  - All colours are CSS custom properties. A forced theme is applied with a `data-theme` attribute on `<html>`.
  - The `color-scheme` property and the `theme-color` meta tag follow the active theme, so native controls and the mobile browser bar match.
  - Both themes are high-contrast and readable from a distance in a bright arena.
- Content respects safe-area insets on notched phones.
- Accessibility:
  - semantic buttons with `aria-label`;
  - `aria-pressed` on the Play/Stop button;
  - an `aria-live` region for status and toasts;
  - WCAG AA contrast.
- Times are displayed as `m:ss` in both languages.
- **Visual identity:**
  - The palette comes from the rink: ice, boards, blue line, goal red and crease blue.
  - The Play/Stop button is drawn as a face-off circle: blue when ready, goal-light red while music plays. A ring around it shows the position in the song.
- **Typography:** only fonts already on the device are used, so nothing is downloaded (NF-8).
  - A condensed display face (DIN Condensed or DIN Alternate on Apple devices, Bahnschrift on Windows, Roboto Condensed on Android) is used for the big button, titles and times.
  - The system UI font is used for all other text.

## 8. Browser support

- Latest versions of Chrome, Edge, Firefox, Safari (macOS, iOS, iPadOS) and Chrome for Android.
- Required APIs: ES modules, `fetch`, Web Crypto (`crypto.subtle` for PKCE, `crypto.randomUUID`) and `localStorage`. All need a secure context (HTTPS or 127.0.0.1).
- Optional APIs, feature-detected: Screen Wake Lock and the Clipboard API.

## 9. Phases

**Phase 1 (MVP)**
- Setup and PKCE authentication, with the redirect URI displayed.
- Device selection.
- Game screen: Play/Stop with the resume-or-advance rules and automatic continuation (§4.2.1), next/previous, wake lock, keyboard shortcuts and playback sync.
- Playlist creation and editing: search, paste a link, start offset (manual entry, nudges, Mark here), preview, reorder.
- Export and import as JSON.
- English and French UI with selector and auto-detection.
- Responsive layout.

**Phase 2 and later:** the candidates and ideas, which are not decided yet, are listed in [`NEXT_STEPS.md`](NEXT_STEPS.md). Items marked "Phase 2" elsewhere in this spec are the technical groundwork already prepared for them.

## 10. Known limitations and risks

- **Spotify must be open:** the Spotify app must stay open on the output device. Idle devices can disappear from the device list, so the user must reopen Spotify and refresh the device list.
- **Latency:** there is a short delay between the tap and the sound, which depends on the network.
- **Track transitions:** the handoff to the next track (R-5) is timed from polled progress. There may be a very short gap, or the last second of a track may be cut.
- **Fade-out:** volume control may be unsupported on some devices, for example iPhones (`supports_volume: false`). Fade-out is skipped on those devices.
- **Data is per browser:** data is stored per browser and per device. Use export and import to move playlists between devices and to keep backups.
- **Development Mode may change:** Spotify states that Development Mode is intentionally limited and will keep evolving. All Spotify calls are isolated in `spotify.js` so changes can be absorbed in one place.
- **Licensing:** the app is for personal, non-commercial use. Spotify Development Mode is intended for personal projects. Public performance licensing in a venue is the venue's responsibility (for example SOCAN and Ré:Sonne in Canada).

## 11. References

- Spotify Web API changelog, February 2026: https://developer.spotify.com/documentation/web-api/references/changes/february-2026
- Spotify blog, "Update on Developer Access and Platform Security" (2026-02-06): https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security
- Spotify migration guide, February 2026: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- Spotify redirect URI rules: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- Spotify Authorization Code with PKCE: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- GitHub Pages documentation: https://docs.github.com/en/pages

## 12. Changelog

| Version | Date | Changes |
|---|---|---|
| 0.8 | 2026-10-18 | The Phase 2 list and the future ideas moved to `NEXT_STEPS.md`, since they are not decided yet. This spec keeps only the Phase 1 scope and the groundwork already prepared. |
| 0.7 | 2026-10-18 | Phase 1 implemented. Recorded the visual identity and typography (§7), the 403 "account not registered" message (§3.4), and three guard rules (G-6, P-5, P-6). |
| 0.6 | 2026-10-18 | Added a theme selector (S-7): Auto, which follows the device, or a forced Light or Dark theme. Added `settings.theme`, plus an inline script in `index.html` that applies the saved theme before first paint. |
| 0.5 | 2026-10-18 | The spec now holds final decisions only. Removed the Open questions section and renumbered sections 10 to 12. |
| 0.4 | 2026-10-18 | Confirmed: automatic continuation starts the next track at its `startMs` (R-5), and the 20 s threshold is cumulative (R-2). |
| 0.3 | 2026-10-18 | Documentation split: this spec covers only the what and the why. Project status and the process instructions moved to `CLAUDE.md`. NF-3 now states the publishing source. No functional change. |
| 0.2 | 2026-10-18 | Play/Stop rules rewritten (§4.2.1). Stop now pauses, and the next Play advances only if the track played ≥ 20 s or more than 60 s have passed since Stop; otherwise it resumes. When a track ends, the next track of the app's playlist starts automatically, and Spotify Autoplay is replaced by that track. Added the `hockeydj.game` storage key. |
| 0.1 | 2026-10-18 | Initial specification: feasibility validated, technologies chosen (static GitHub Pages, vanilla JS, Spotify Connect via the Web API, PKCE, localStorage), endpoints checked against the February 2026 Spotify changes, EN/FR i18n added. |
