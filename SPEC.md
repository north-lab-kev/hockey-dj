# Hockey DJ — Specification

| | |
|---|---|
| **Version** | 1.5 |
| **Last updated** | 2026-10-27 |
| **Live URL** | https://north-lab-kev.github.io/hockey-dj/ |

> This document defines **what** Hockey DJ does and **why**. It is the source of truth for requirements and technical decisions, and changes to it are recorded in the [Changelog](#12-changelog).
> How to work on the project (conventions, procedures, current status) is covered in [`CLAUDE.md`](CLAUDE.md). The user guide is in [`README.md`](README.md).

---

## 1. Purpose

Hockey DJ is a web app for playing music in a hockey arena during stoppages of play. At each stoppage, the operator taps a big button to start a song at its most energetic moment (e.g. the chorus). When play resumes, the operator taps the same button to stop it. Each button plays its own playlist (for example warm-up music or a goal song).

- **Music source:** the operator's Spotify Premium account.
- **Users:** single user. There are no user accounts in the app.
- **Use:** personal, non-commercial use only.

## 2. Non-functional requirements

| ID | Requirement |
|---|---|
| NF-1 | Runs in any modern browser on Windows, Android, iOS/iPadOS, tablets and phones. |
| NF-2 | Nothing to install. Installing the app on a home screen or desktop is optional (§4.7). |
| NF-3 | No backend and no database. Static files only, hosted for free on GitHub Pages from a public repository, published from the `main` branch root. |
| NF-4 | All user data is stored locally in the browser (localStorage). Nothing is sent anywhere except Spotify. |
| NF-5 | Responsive and mobile-first. Must be fully usable one-handed on a phone in portrait mode. The Game screen must also be fully usable in a narrow, tall window, such as one side of a Chrome split view (about 220 px wide). |
| NF-6 | Bilingual UI: English and French, with a language selector. The default language is detected from the browser. |
| NF-7 | Plain HTML, CSS and JavaScript (native ES modules). No framework, no npm, no build step. |
| NF-8 | No third-party runtime dependencies. Exception: the Spotify Web Playback SDK script (§3.4). |
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
  | Current | `user-read-playback-state`, `user-modify-playback-state`; `playlist-read-private`, `playlist-read-collaborative` (Spotify playlist import, P-9); `streaming`, `user-read-email`, `user-read-private` (browser player, §3.4) |

  The granted scopes are stored. If the code requires scopes that were not granted, the app asks the user to reconnect.
- **Disconnect:** deletes the tokens. The Client ID and playlists are kept.

### 3.3 Endpoints used

All endpoints below are on Spotify's "Endpoints still available" list, checked on 2026-10-18 against the Web API changelog for February 2026: https://developer.spotify.com/documentation/web-api/references/changes/february-2026

| Purpose | Endpoint | Notes |
|---|---|---|
| Play a track from an offset | `PUT /v1/me/player/play?device_id={id}` | Body: `{"uris":["spotify:track:…"],"position_ms":45000}` |
| Stop | `PUT /v1/me/player/pause` | |
| List devices | `GET /v1/me/player/devices` | Device objects include `id`, `name`, `type` and `is_active` |
| Playback state and progress | `GET /v1/me/player` | Used for "Mark here" and for state sync while playing |
| Activate a device | `PUT /v1/me/player` | Body: `{"device_ids":["…"],"play":false}` |
| Search tracks | `GET /v1/search?q=…&type=track&limit=10&offset=…` | Maximum `limit` is 10 |
| Resolve a pasted link | `GET /v1/tracks/{id}` | The batch `GET /tracks` was removed |
| Profile (display name and user ID) | `GET /v1/me` | `product`, `email` and `country` are no longer returned. The `id` tells which playlists the user owns (P-9) |
| Import a Spotify playlist (P-9) | `GET /v1/me/playlists?limit=50&offset=…`, `GET /v1/playlists/{id}/items?limit=50&offset=…` | Checked again on 2026-10-20. `GET /me/playlists` also lists followed playlists, but contents are returned only for playlists the user owns or collaborates on. The track count is `items.total`, and each entry's track is `item` (the older `track` field is deprecated). Pages hold at most 50 entries |
| Browser player (§3.4) | Web Playback SDK script `https://sdk.scdn.co/spotify-player.js` | "Web Playback SDK" is enabled in the app's dashboard (confirmed by the owner on 2026-10-20). The browser device is then played and paused with the same Web API calls as any other device |

**Do not use** (removed in Development Mode): `GET /tracks`, `GET /artists/{id}/top-tracks`, `GET /users/{id}`, `GET /users/{id}/playlists`, the `/playlists/{id}/tracks` endpoints (use `/items`), and the `popularity` fields.

### 3.4 Playback model

- **Primary mode: Spotify Connect remote control.** The app sends commands, and the Spotify app plays the audio on a target device. That device can be the same phone or tablet, or a computer connected to the arena's sound system. This works in every browser, iOS included.
  - **Requirement:** the Spotify app must be open on the target device.
- **Browser player: Web Playback SDK.** The browser tab itself becomes a Spotify device, so no Spotify app is needed on that computer.

  | ID | Rule |
  |---|---|
  | B-1 | The player runs in desktop browsers that support protected content (EME), and in Android browsers as an experimental option. It never runs on iPhone or iPad. Once connected, the app creates it automatically at startup, with the device name "Hockey DJ". |
  | B-2 | The device list shows "This browser" first, with its state: plays here, experimental on Android, getting ready, reconnecting, or the error. The same device's entry returned by `GET /me/player/devices` is hidden, and the help text mentions the browser player. |
  | B-3 | Choosing it saves `settings.deviceId = "browser"`. Each request maps this value to the live SDK device ID, which can change on every page load. On desktop, when no device is saved, the browser player is selected as soon as it is ready. On Android it is never selected automatically. |
  | B-4 | Browsers allow sound only after a user gesture, so Play, Previous, Next and tap-to-select while playing, and Preview, unlock the player's audio during the tap. Automatic continuation (R-5) then plays without a tap. |
  | B-5 | Errors (the SDK can't load, protected content is unavailable, the account isn't Premium, a permission is missing) are shown on the "This browser" entry and when Play is pressed, and the device picker opens. A playback error shows a toast. |
- **Device selection:** the selected device ID is saved. If that device is missing or inactive, the app activates it with Transfer Playback before playing.
- **Sync:** while the state is Playing and the page is visible, the app polls `GET /v1/me/player` every 5 s. Polling keeps the progress up to date and detects external changes.
  - **Same track:** Spotify sometimes plays another copy of the same recording, with another ID, when the requested one isn't playable in the user's country (track relinking). A poll shows our track when the item's ID is the one the app asked for, or the one linked to it in `hockeydj.trackLinks` (§5.1). In the first 12 s after a start, a playing item with another ID whose progress is within 2.5 s of the app's own progress is that copy: the app saves the link and keeps playing, so the song is never skipped, and it is recognized right away the next time. Tracks are only ever compared by ID, never by name.
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
| G-1 | **Game buttons.** The Game screen shows one round Play/Stop button per playlist that has a button (G-10), button 1 first. Each one shows its playlist's name (at most two lines), a play or stop icon, and the position in the song. Its state is shown by colour, icon and `aria-pressed`, never by colour alone, and its accessible name is "Play {playlist}" or "Stop {playlist}". The buttons share the screen height so that they all fit without scrolling, on a phone in portrait mode and in a window of about 220 × 900 px. Each one is as large as the space allows: a single button takes about 40 % of the height on a phone in portrait mode. |
| G-2 | **Play** and **Stop** follow the rules in §4.2.1, for the playlist of the button. Only one playlist plays at a time. |
| G-3 | Feedback is optimistic: the button changes state immediately and shows a small busy indicator. If the request fails, it reverts and shows an error toast. Taps on any game control made while a request is in flight are ignored. |
| G-4 | Each button forms a framed **group**. Under the button are Previous and Next, with two tracks between them. The first one is the track that plays, labelled "Now playing", or while Stopped the one the next Play starts (R-9). Under it, smaller, is the track that follows, labelled "Then" (R-15). In a window narrower than 300 px, Previous and Next move under the two tracks, which then get the full width. The playing group is framed in red. The Game screen has no full song list. |
| G-5 | Previous and Next of a group select or prepare a track of its playlist (R-7). |
| G-6 | **Switching:** tapping another group's button while music plays stops the playing playlist exactly like Stop (R-1), then starts the tapped playlist by its own rules (R-2, R-3, R-15). This takes a single play request, with no pause in between. If the request fails, the first playlist keeps playing and an error toast is shown. |
| G-7 | An indicator shows the selected device. A warning appears when no device is available. On narrow screens it shows only its icon. |
| G-8 | Keyboard shortcuts on desktop: `Space` = Play/Stop of the last-used group, `1` to `4` = the game button with that number, `→` / `←` = next/previous track of the last-used group. The last-used group is the one whose button, Previous or Next was used last. It is saved in `settings.activePlaylistId`. |
| G-9 | The Screen Wake Lock API keeps the screen on while the Game screen is visible. It is re-acquired on `visibilitychange`, and silently skipped where unsupported. |
| G-10 | **Buttons:** there are four game buttons, numbered 1 to 4. Each one can hold one playlist, and a playlist has at most one button (P-11). Buttons without a playlist are not shown, and the others keep the order of their numbers. |
| G-11 | When no button has a playlist, the Game screen shows a message and a button that opens the Playlists screen. A group whose playlist has no songs shows "No songs", and tapping its button shows an error toast. |
| G-12 | On wide screens, the groups are laid out in a grid of up to three columns. |

#### 4.2.1 Play/Stop logic

Each playlist has its own game state, so every button keeps its place. For its current track, the app keeps three values:
- `positionMs`: where playback was paused.
- `playedMs`: the **cumulative** time the track has actually played since it became the current track. It is measured locally, from each successful play request until Stop or a track change.
- `stoppedAt`: when Stop was last pressed.

| ID | Rule |
|---|---|
| R-1 | **Stop** pauses playback and saves `positionMs` and `stoppedAt`. It does not move the pointer. |
| R-2 | **Play after a Stop** advances to the next track and starts it at its `startMs` if **at least one** of these is true: (a) `playedMs ≥` the played threshold (20 s by default), meaning the current track has already played that long in total; (b) `now − stoppedAt >` the idle window (60 s by default), meaning that much time has passed since Stop. Both values are user settings (S-8). |
| R-3 | Otherwise, **Play resumes** the current track at `positionMs` (at least 1 s before its end, P-10), like a pause. The app resumes by sending the track URI again with `position_ms`, never with a bare resume, so it cannot resume something else. |
| R-4 | Whenever the current track changes, `playedMs` resets to 0 and `positionMs` is set to the new track's `startMs`. |
| R-5 | **End of track:** when the current track reaches its end while playing (its marked end, P-10, or the end of the song), the app immediately plays the next track at that track's `startMs`: the prepared track (R-15) if there is one, otherwise the next one in the playlist or in the shuffled order (§4.2.2). Playback continues until Stop is pressed. |
| R-6 | In playlist order, the pointer wraps from the last track back to the first. In shuffle mode, R-12 applies. |
| R-7 | **Explicit selection** (Previous and Next of a group): while the group is Stopped, it selects the track before or after the one its next Play would start. The next Play then starts the selected track at its `startMs`, bypassing R-2 and R-3. While the group is Playing, it moves the track that follows ("Then") one step back or forward, and the current track keeps playing (R-15). |
| R-8 | The defaults of the two thresholds are constants in `app.js`: `ADVANCE_AFTER_PLAYED_MS = 20000` and `ADVANCE_AFTER_IDLE_MS = 60000`. A missing, invalid or out-of-range stored value falls back to its default. |
| R-9 | While Stopped, each group always shows what its next Play will do: "Resumes at m:ss", "Next" or "Starts at m:ss", above the track's title. When the idle window expires, the label updates by itself. |
| R-10 | The game state of each playlist (`currentIndex`, `positionMs`, `playedMs`, `stoppedAt`, the shuffle passes of R-14 and the prepared track of R-15) is saved, so a page reload keeps the user's place in every playlist. After a reload, a track that is still playing is picked up for the last-used group (G-8). Previews in the playlist editor never change the game state. Deleting a playlist deletes its game state. |
| R-15 | **Prepared track:** a track chosen with Previous or Next while the group is Playing is the prepared track. It plays when the current track ends (R-5), or on the next Play after a Stop, at its `startMs` and bypassing R-2 and R-3. It is then cleared. It is also cleared when it is removed from the playlist. While the group is Stopped, the prepared track is the one the next Play starts, so Previous and Next start from it (R-7). |

#### 4.2.2 Shuffle

| ID | Rule |
|---|---|
| R-11 | **Shuffle** (S-9, on by default) plays the songs of each playlist in a random order. That order is used by automatic continuation (R-5), by the next track chosen in R-2, and by Previous and Next (R-7). |
| R-12 | A **pass** plays every song of the playlist once. When a pass ends, a new random order starts, and its first song is never the one that just ended (when the playlist has more than one song). Previous on the first song of a pass goes back to the last song of the previous pass. The app keeps only one previous pass: beyond it, Previous wraps to the end of the current pass. |
| R-13 | After Previous or Next (R-7, R-15), play continues in the shuffled order from the selected or prepared song. |
| R-14 | The game state of each playlist stores three passes of track IDs: the previous one, the current one and the next one. A reload therefore keeps the order (R-10). A new game (a playlist with no saved order) starts on a random song. Turning shuffle on keeps the current song and shuffles the others after it. Turning it off returns to the playlist order from the current song. A song added to the active playlist is inserted at a random position later in the current pass and in the next pass, and a removed song is dropped from them. |

### 4.3 Playlist management

| ID | Requirement |
|---|---|
| P-1 | Create, rename, duplicate and delete playlists. Deleting requires confirmation. |
| P-2 | Add tracks by searching (10 results per page, with a "Load more" button that uses `offset`) or by pasting a Spotify track link or URI. Accepted formats: `https://open.spotify.com/track/{id}`, `https://open.spotify.com/intl-xx/track/{id}`, either with an optional query string, and `spotify:track:{id}`. A track that is already in the playlist (same track ID) is never added twice: its search result shows as added. |
| P-3 | When a track is added, its metadata is stored with it: `id`, `uri`, `name`, `artists`, `imageUrl` and `durationMs`. The app never needs to re-fetch it. |
| P-4 | Each track has a start offset (`startMs`), shown as `m:ss`. It can be set in two ways: (a) typing `m:ss` or seconds in the Start field; (b) **Mark start**: while the track is previewing, this reads `progress_ms` from `GET /v1/me/player` and saves it as the start. When the start is after 0:00, a x button resets it to 0:00. |
| P-5 | **Preview** plays the track from its `startMs` and stops by itself at its end (P-10). A Stop control is available. Preview is unavailable while game music plays, and it stops when the user leaves the editor. |
| P-6 | Tracks can be reordered (up/down buttons; drag-and-drop is optional) and removed. The track that is playing in the game cannot be removed, and a playlist cannot be deleted while its music plays. |
| P-7 | Validation: `0 ≤ startMs ≤ durationMs − 1 s`. Out-of-range values are clamped and a warning is shown. A start moved to less than 1 s before the marked end removes that end, with a warning. |
| P-8 | Every change is saved immediately (autosave). There is no Save button. |
| P-10 | Each track can have a marked end (`endMs`), where play stops and moves on to the next track (R-5). It is optional: `null` means the end of the song. It can be set by typing `m:ss` or seconds in the End field (empty or the song's length clears it), with **Mark end** while previewing, or cleared with a × button. It must be at least 1 s after the start, otherwise it is refused with a warning. The Game list and the editor show "start → end" when an end is marked, and the progress ring and the time shown go up to that end. Changing the end of the track that is playing applies at once. |
| P-11 | **Game button:** the editor has a "Game button" picker with None and 1 to 4 (G-10). Under each number it shows the playlist that holds that button, or "free". Picking a button that another playlist holds takes it from that playlist. While music plays, the playlist that plays can't change its button or lose it to another playlist. The Playlists screen shows a "Button N" badge next to each playlist that has one. Duplicated and imported playlists have no button. Deleting a playlist frees its button. The first playlist created while no button holds a playlist gets button 1. |
| P-9 | **Import a Spotify playlist** into the playlist being edited. The picker lists only the user's playlists that they own or collaborate on. The songs are added at the end, in the Spotify order, with `startMs = 0`. Songs already in the playlist (same track ID) and repeats inside the Spotify playlist are skipped, and so are local files and podcast episodes. A message then reports how many songs were added, skipped as duplicates, and unavailable. |

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
| S-8 | "Next song" section with the two R-2 thresholds: the played threshold (1 s to 5:00, default 0:20) and the idle window (5 s to 10:00, default 1:00). Each one is set by typing `m:ss` or seconds, or with −5 s / +5 s buttons. Values are rounded to the second, and out-of-range values are clamped with a warning. They are saved in `settings.advanceAfterPlayedMs` and `settings.advanceAfterIdleMs` and apply to the next Play. A "Restore defaults" button sets both back to `null`, which means the default. |
| S-9 | Play order selector in the "Next song" section: Shuffle (default) or Playlist order (§4.2.2). The choice is saved in `settings.shuffle` and applies immediately to every playlist, also during a game. |

### 4.6 Internationalisation (i18n)

| ID | Requirement |
|---|---|
| I-1 | Supported languages are `en` and `fr`. All UI strings live in `i18n.js`. No user-facing text is hard-coded anywhere else. |
| I-2 | Default language: the app walks through `navigator.languages` (falling back to `[navigator.language]`). The first entry starting with `fr` gives `fr`, and the first starting with `en` gives `en`. If neither matches, it uses `en`. |
| I-3 | An explicit choice in the selector is saved (`settings.language`) and overrides detection. "Auto" clears it. |
| I-4 | Switching language re-renders the UI immediately, without a reload, and updates `<html lang>`. |
| I-5 | The language is changed only in Settings (S-1). The header has no language toggle, so before the first connection the language follows detection (I-2). |
| I-6 | Strings support named parameters, for example `t('import.done', { playlists: 2, tracks: 31 })`. |

### 4.7 Installation

| ID | Requirement |
|---|---|
| A-1 | The app is installable: "Install" in Chrome and Edge, "Add to Home Screen" on Android and iOS. Once installed, it opens full screen from its own icon. |
| A-2 | `manifest.json`: `name` and `short_name` "Hockey DJ", `display: standalone`, `id`, `start_url` and `scope` set to `./`, and background and theme colour `#0B1424`. The relative paths keep the PKCE redirect URI unchanged (§3.2) in production and in local development. |
| A-3 | Icons: the face-off mark (red ring and hash marks, blue dot, in the dark-theme colours) on a dark `#0B1424` background. `icon.svg` and the 192 and 512 px PNGs have rounded corners. `icon-maskable-512.png` is full bleed, with the mark inside the maskable safe zone. `apple-touch-icon.png` (180 px, full bleed) is for iOS. `icon.svg` is also the favicon. |
| A-4 | No offline mode, because every action needs Spotify. The only service worker is the one that keeps files up to date (U-1). |

### 4.8 Updates

| ID | Requirement |
|---|---|
| U-1 | **Latest files on every load.** `sw.js` is a service worker that revalidates every same-origin request with the server (`cache: "no-cache"`) instead of using the browser cache, so each page load gets the files that are deployed. Unchanged files come back as a quick 304. It is registered with `updateViaCache: "none"`, so the browser checks `sw.js` itself on every load. It caches nothing for offline use. |
| U-2 | **New version while the app is open.** `version.js` holds `APP_VERSION`, shown in Settings → About. Each release changes it. The app loads the deployed `version.js` again every 30 minutes and whenever the page becomes visible. When it differs, a banner offers to reload ("Reload between two stoppages"). The app never reloads by itself, so a game is never cut. |

## 5. Data model

### 5.1 localStorage keys

All keys are prefixed with `hockeydj.`. Each value is JSON. Only `storage.js` reads or writes them.

| Key | Content |
|---|---|
| `hockeydj.settings` | `{ "language": "en" \| "fr" \| null, "theme": "light" \| "dark" \| null, "clientId": "…", "deviceId": "…" \| "browser", "activePlaylistId": "…", "buttons": ["playlistId" \| null, …], "advanceAfterPlayedMs": 20000 \| null, "advanceAfterIdleMs": 60000 \| null, "shuffle": true \| false }` (`null` = default, S-8; `shuffle` defaults to `true`, S-9; `activePlaylistId` is the last-used group, G-8; `buttons` has four entries, index 0 = button 1, G-10) |
| `hockeydj.game` | `{ "playlists": { "playlistId": GameState, … } }`. A GameState is `{ "currentIndex": 0, "positionMs": 45000, "playedMs": 12000, "stoppedAt": "2026-10-18T19:30:00.000Z" \| null, "shuffle": { "past": ["trackId", …] \| null, "order": ["trackId", …], "upcoming": ["trackId", …] } \| null, "prepared": { "trackId": "…", "shuffle": { … } \| null } \| null }` (see R-10, R-14 and R-15; `shuffle` is `null` in playlist order) |
| `hockeydj.auth` | `{ "accessToken": "…", "refreshToken": "…", "expiresAt": 1760000000000, "scopes": ["…"] }` |
| `hockeydj.playlists` | `{ "schemaVersion": 2, "playlists": [ Playlist, … ] }` |
| `hockeydj.trackLinks` | `{ "requestedTrackId": "playedTrackId", … }`: the copy that Spotify plays for a requested track (§3.4). Learned during play, never exported. |
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
      "startMs": 45000,
      "endMs": 130000
    }
  ]
}
```

IDs are generated with `crypto.randomUUID()`.

### 5.3 Export file

```json
{
  "app": "hockey-dj",
  "schemaVersion": 2,
  "exportedAt": "2026-10-18T19:10:00.000Z",
  "playlists": [ /* Playlist objects */ ]
}
```

### 5.4 Schema changes

Any change to the stored format increments `schemaVersion` and adds a migration function in `storage.js`. Migrations run on load.

- **Version 2:** adds `endMs` to each track (P-10). Stored version 1 playlists get `endMs: null`. Version 1 export files are still accepted by import, and their tracks get no end.
- **Game state per playlist (spec 1.2):** `hockeydj.game` and `settings.buttons` are not part of export files, so `schemaVersion` is unchanged. On load, `storage.js` turns an old single game state into the entry of `activePlaylistId`, and settings saved without `buttons` give button 1 to `activePlaylistId`.

## 6. Architecture and files

All files are at the repository root.

| File | Responsibility |
|---|---|
| `index.html` | Page shell, meta tags (viewport with `viewport-fit=cover`, theme colour), and loading `app.js` as a module. It also holds a tiny inline script in `<head>` that applies the saved theme before first paint, so a forced theme never flashes. This script is the only read of localStorage outside `storage.js`, and it is read-only. |
| `style.css` | All styles. Mobile-first, CSS custom properties, light and dark themes. |
| `app.js` | Bootstrap, OAuth callback handling, view routing (Setup / Game / Playlists / Settings) and app state. |
| `spotify.js` | **The only module that talks to Spotify:** PKCE auth, token refresh, every Web API call with error mapping, and the Web Playback SDK player (§3.4). |
| `storage.js` | **The only module that touches localStorage:** settings, auth, playlists, track links, migrations, export and import. |
| `i18n.js` | Dictionaries (`en`, `fr`), language detection, `t()` and DOM translation helpers. |
| `ui.js` | Rendering of views and components, toasts and dialogs. |
| `manifest.json`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | Installation (§4.7). |
| `sw.js`, `version.js` | Updates (§4.8): the service worker, and the app version. |
| `README.md` | Repository home page: overview, user setup guide, privacy notes, development quick start. |
| `SPEC.md` | This document. |
| `CLAUDE.md` | Guidance for AI-assisted development sessions. |

## 7. UX and visual design

- Mobile-first. Touch targets are at least 48 × 48 px. The game buttons are the visual priority.
- **Game screen layout:** the groups (G-4) are stacked in one column on narrow screens, and their buttons shrink so that every group fits in the height. A Chrome split view about 220 px wide is a target. On wide screens they form a grid of up to three columns (G-12).
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
  - `aria-pressed` on the game buttons;
  - an `aria-live` region for status and toasts;
  - WCAG AA contrast.
- Times are displayed as `m:ss` in both languages.
- **Visual identity:**
  - The palette comes from the rink: ice, boards, blue line, goal red and crease blue.
  - Each game button is drawn as a face-off circle: blue when ready, goal-light red while music plays. A ring around it shows the position in the song.
- **Typography:** only fonts already on the device are used, so nothing is downloaded (NF-8).
  - A condensed display face (DIN Condensed or DIN Alternate on Apple devices, Bahnschrift on Windows, Roboto Condensed on Android) is used for the game buttons, titles and times.
  - The system UI font is used for all other text.

## 8. Browser support

- Latest versions of Chrome, Edge, Firefox, Safari (macOS, iOS, iPadOS) and Chrome for Android.
- Required APIs: ES modules, `fetch`, Web Crypto (`crypto.subtle` for PKCE, `crypto.randomUUID`) and `localStorage`. All need a secure context (HTTPS or 127.0.0.1).
- Optional APIs, feature-detected: Screen Wake Lock, the Clipboard API, and Encrypted Media Extensions for the browser player (B-1).

## 9. Phases

**Phase 1 (MVP)**
- Setup and PKCE authentication, with the redirect URI displayed.
- Device selection.
- Game screen: Play/Stop with the resume-or-advance rules and automatic continuation (§4.2.1), next/previous, wake lock, keyboard shortcuts and playback sync.
- Playlist creation and editing: search, paste a link, start offset (manual entry, nudges, Mark here), preview, reorder.
- Export and import as JSON.
- English and French UI with selector and auto-detection.
- Responsive layout.

**Phase 2**
- R-2 thresholds in Settings (S-8).
- Shuffle (§4.2.2).
- Spotify playlist import (P-9).
- Language in Settings only (I-5).
- Installation (§4.7).
- Browser player (§3.4, B-1 to B-5).

**Phase 3**
- Game buttons: up to four playlists on the Game screen, each with its own game state (G-1 to G-12, P-11).
- Previous and Next prepare the following track while music plays (R-15).
- Game screen layout for a narrow Chrome split view (NF-5, §7).

## 10. Known limitations and risks

- **Browser player:** the music stops if the tab is closed, so the tab must stay open during a game. Some browsers ask before playing protected content (DRM), for example Firefox. On Android, playback may stop when the screen locks or the tab goes to the background.
- **Spotify must be open:** with any device other than the browser player, the Spotify app must stay open on the output device. Idle devices can disappear from the device list, so the user must reopen Spotify and refresh the device list.
- **Latency:** there is a short delay between the tap and the sound, which depends on the network.
- **Track transitions:** the handoff to the next track (R-5) is timed from polled progress. There may be a very short gap, or the last second of a track may be cut.
- **Installed on iOS:** an app added to the iOS home screen has its own storage, separate from Safari. The user connects again there and moves playlists with export and import.
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
| 1.5 | 2026-10-27 | Fixed songs that changed a few seconds after they started: when Spotify plays another copy of the requested track (track relinking), the app recognizes it by its progress, saves the link between the two IDs in `hockeydj.trackLinks` and keeps playing (§3.4, §5.1, §6). |
| 1.4 | 2026-10-27 | Game buttons are limited to four (G-8, G-10, P-11, §5.1). In a window narrower than 300 px, Previous and Next move under the two tracks of each group (G-4). |
| 1.3 | 2026-10-27 | Each group now always shows two tracks: the one that plays (or that Play will start) and the one that follows (G-4). |
| 1.2 | 2026-10-27 | Added game buttons (G-1 to G-12, P-11): up to five playlists each get their own round button on the Game screen, labelled with the playlist's name, with Previous, Next and the next track in a framed group. Tapping another button switches playlists in one tap. Each playlist keeps its own game state (§4.2.1, R-10, R-14). Previous and Next while playing now prepare the following track instead of starting it (R-7, R-15). The playlist selector, the now-playing card and the song list left the Game screen (R-13). The Game screen fits a narrow Chrome split view (NF-5, §7). §1, §5.1, §5.4 and §9 updated. |
| 1.1 | 2026-10-20 | Added updates (§4.8, U-1 and U-2): a service worker that revalidates every file on each load, and a banner when a newer version is deployed while the app is open. `APP_VERSION` moved to `version.js`. A-4 and §6 updated. |
| 1.0 | 2026-10-20 | Version 1.0: Phase 1 and Phase 2 are complete, and the app version is 1.0. No functional change. |
| 0.18 | 2026-10-20 | A x button resets the start to 0:00, like the one that removes the end (P-4). |
| 0.17 | 2026-10-20 | Added an optional marked end per track (P-10) with Mark end, and renamed Mark here to Mark start. Removed the ±1 s and ±5 s nudge buttons from the editor (P-4). Preview stops at the end (P-5), R-3, R-5 and P-7 updated. Playlist schema version 2 (§5.4). |
| 0.16 | 2026-10-20 | Removed `NEXT_STEPS.md`. §9 now lists what Phase 2 delivered. |
| 0.15 | 2026-10-20 | Added the browser player (Web Playback SDK, §3.4, B-1 to B-5): default device on desktop, experimental on Android, never on iPhone or iPad. Its three scopes are now required (§3.2), so users reconnect once. NF-8, §3.3, §5.1, §6, §8 and §10 updated. |
| 0.14 | 2026-10-20 | Added installation (§4.7, A-1 to A-4): manifest, icons and iOS meta tags, without a service worker. NF-2, §6 and §10 updated. |
| 0.13 | 2026-10-20 | Added the Spotify playlist import (P-9) into the playlist being edited, without duplicates. P-2 now states that a track is never added twice. The playlist scopes are now required (§3.2), so existing users reconnect once. §3.3 endpoints checked again. |
| 0.12 | 2026-10-20 | Removed the EN / FR toggle from the header. The language is now changed only in Settings (I-5). |
| 0.11 | 2026-10-20 | Added shuffle (§4.2.2, R-11 to R-14), on by default and set in Settings (S-9). A new random order starts at every pass, Previous and Next follow the shuffled order, and the order is kept across a reload. R-5, R-6, R-10 and §5.1 updated. |
| 0.10 | 2026-10-20 | The two R-2 thresholds (played 20 s, idle 60 s) are now user settings (S-8), saved in `hockeydj.settings`. The constants of R-8 are their defaults. |
| 0.9 | 2026-10-20 | Dropped the fade-out on Stop: the Spotify volume control is not reliable on every device. Removed the volume endpoint (§3.3) and the related limitation (§10). |
| 0.8 | 2026-10-18 | The Phase 2 list and the future ideas moved to `NEXT_STEPS.md`, since they are not decided yet. This spec keeps only the Phase 1 scope and the groundwork already prepared. |
| 0.7 | 2026-10-18 | Phase 1 implemented. Recorded the visual identity and typography (§7), the 403 "account not registered" message (§3.4), and three guard rules (G-6, P-5, P-6). |
| 0.6 | 2026-10-18 | Added a theme selector (S-7): Auto, which follows the device, or a forced Light or Dark theme. Added `settings.theme`, plus an inline script in `index.html` that applies the saved theme before first paint. |
| 0.5 | 2026-10-18 | The spec now holds final decisions only. Removed the Open questions section and renumbered sections 10 to 12. |
| 0.4 | 2026-10-18 | Confirmed: automatic continuation starts the next track at its `startMs` (R-5), and the 20 s threshold is cumulative (R-2). |
| 0.3 | 2026-10-18 | Documentation split: this spec covers only the what and the why. Project status and the process instructions moved to `CLAUDE.md`. NF-3 now states the publishing source. No functional change. |
| 0.2 | 2026-10-18 | Play/Stop rules rewritten (§4.2.1). Stop now pauses, and the next Play advances only if the track played ≥ 20 s or more than 60 s have passed since Stop; otherwise it resumes. When a track ends, the next track of the app's playlist starts automatically, and Spotify Autoplay is replaced by that track. Added the `hockeydj.game` storage key. |
| 0.1 | 2026-10-18 | Initial specification: feasibility validated, technologies chosen (static GitHub Pages, vanilla JS, Spotify Connect via the Web API, PKCE, localStorage), endpoints checked against the February 2026 Spotify changes, EN/FR i18n added. |
