# CLAUDE.md

This file guides Claude, and any developer, working in this repository. Read it first, then read `SPEC.md`.

## Project in one paragraph

Hockey DJ is a static web app for playing Spotify music in a hockey arena during stoppages of play. One big Play/Stop button starts each song at a chosen offset (for example, the chorus) and stops it when play resumes. It has a single user and is for personal, non-commercial use. It has no backend: it is hosted on GitHub Pages and stores all of its data in the browser's localStorage. **`SPEC.md` is the source of truth** for requirements and decisions.

- **Live:** https://north-lab-kev.github.io/hockey-dj/
- **Repository:** https://github.com/north-lab-kev/hockey-dj (public). GitHub Pages publishes the `main` branch from the root folder.

## Working agreements

- **Language:** the project owner writes in French, so reply to him in French. Everything committed to the repository must be in English: code, identifiers, comments, docs and commit messages.
- **Keep `SPEC.md` current:** any change to behaviour, requirements or technical decisions must update `SPEC.md` in the same change, with a version bump and a Changelog entry.
- **Keep this file current:** update [Current status](#current-status) at the end of each working session.
- **Delivery:** the owner uploads files through the GitHub web UI (Add file → Upload files). Keep every file **flat at the repository root**, with no folders, unless the owner agrees otherwise. When delivering changes from a chat, list exactly which files changed. With Claude Code on the web, changes land on a branch, and the owner merges into `main` to deploy.
- **Questions:** ask before adding a feature that is not in `SPEC.md`. Propose spec changes explicitly.

## Hard technical rules

1. Plain HTML, CSS and JavaScript with native ES modules. **No framework, no npm, no bundler, no build step.**
2. **No runtime dependencies.** The only planned exception is the Spotify Web Playback SDK (Phase 2), loaded from `https://sdk.scdn.co/spotify-player.js`.
3. **No backend.** Never introduce a server, a proxy or a third-party API other than Spotify.
4. **`spotify.js` is the only module that calls Spotify** (accounts and Web API). Never call `fetch` to Spotify anywhere else.
5. **`storage.js` is the only module that touches localStorage.** Every key is prefixed with `hockeydj.`. Any change to the stored format bumps `schemaVersion` and adds a migration.
6. **All user-facing text goes through `i18n.js`.** Add each new key to both `en` and `fr` in the same change, and never hard-code UI strings.
7. **Never use or store a Client Secret.** Never commit a Client ID, tokens or personal data. Exports must never contain tokens.
8. Mobile-first and responsive. Touch targets are at least 48 px. The big Play/Stop button is the top UX priority, and must be fast and unambiguous.
9. Feature-detect optional APIs (Wake Lock, Clipboard), and degrade silently when they are missing.

## File map

| File | Role |
|---|---|
| `index.html` | Page shell. Loads `app.js` as `type="module"`. |
| `style.css` | All styles: mobile-first, CSS variables, light and dark themes. |
| `app.js` | Bootstrap, OAuth callback, view routing, app state. |
| `spotify.js` | PKCE auth, token refresh, all Web API calls, error mapping. |
| `storage.js` | localStorage wrapper, migrations, export and import. |
| `i18n.js` | `en` and `fr` dictionaries, language detection, `t()`. |
| `ui.js` | Views, components, toasts, dialogs. |
| `SPEC.md` | Specification (source of truth). |
| `CLAUDE.md` | This file. |

## Spotify API rules (read before touching `spotify.js`)

**Development Mode.** The app runs in Spotify **Development Mode**, under the rules introduced in February 2026:
- the owner needs Premium;
- at most 5 allow-listed users;
- only a restricted set of endpoints;
- search `limit` is capped at 10.

**Checking endpoints.** Before using an endpoint that is not already listed in `SPEC.md` §3.3, confirm it is on the "Endpoints still available" list in https://developer.spotify.com/documentation/web-api/references/changes/february-2026. Also check any later changelog.

**Removed in Development Mode (do not use):**
- `GET /tracks` (batch);
- `GET /artists/{id}/top-tracks`;
- `GET /users/{id}` and `GET /users/{id}/playlists`;
- `/playlists/{id}/tracks` (use `/playlists/{id}/items`);
- browse and new-release endpoints.

**Field changes:**
- On playlists, `tracks` became `items` and `track` became `item`.
- Playlist contents are returned only for playlists the user owns or collaborates on.
- Tracks no longer include `popularity`.
- `/me` no longer includes `product`, `email` or `country`.

**OAuth:**
- Use only Authorization Code with PKCE. The implicit grant is gone.
- Redirect URIs must be HTTPS or a loopback IP (`http://127.0.0.1:PORT`); `localhost` is rejected.
- The redirect URI must match a registered URI exactly.

**Redirect URI:** computed at runtime as `location.origin + location.pathname`, minus any trailing `index.html`.
- Production: `https://north-lab-kev.github.io/hockey-dj/`
- Local: `http://127.0.0.1:8000/`

**Playback model:** Spotify Connect remote control.
- `PUT /me/player/play` with `{"uris":[…], "position_ms": …}` starts a track at its offset.
- `PUT /me/player/pause` stops it.
- The Spotify app must be open on the target device.

**HTTP errors to handle:**

| Status | Handling |
|---|---|
| 401 | Refresh the token, then retry once. |
| 403 | Premium required, or a restriction. |
| 404 | No active device. |
| 429 | Respect `Retry-After`. `reason: QUOTA_EXCEEDED` needs a clear message. |

## Local development

```bash
# from the repository root (ES modules do not work from file://)
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/
```

- Register `http://127.0.0.1:8000/` as an additional Redirect URI in the Spotify dashboard (app → Settings → Redirect URIs).
- **Deploy:** commit to `main`. GitHub Pages republishes within a few minutes. Hard-refresh, or use a private window, to bypass the cache.

## Manual test checklist

There are no automated tests. Run this checklist before each release.

1. **First launch.** Language matches the browser (FR or EN). The EN/FR toggle switches every string without a reload.
2. **Setup and connection.** Enter the Client ID. The redirect URI is shown and copyable. Connecting returns to the app with a clean URL, and the display name is shown.
3. **Session persistence.** Reload the page: still connected. Wait more than 1 h, or force expiry: the token refreshes silently.
4. **Device selection.** The device list shows the open Spotify app. With Spotify closed, a clear message appears.
5. **Playlist editing.** Create a playlist. Search (load more works), and paste a link (`open.spotify.com` with and without `intl-xx`, and `spotify:track:`).
6. **Start offset.** Set a start offset by typing, by nudging, and with Mark here while previewing. Out-of-range values are clamped.
7. **Game screen: Play/Stop.** Play starts at the offset. Stop pauses and advances the pointer. Double taps are ignored while a request is pending.
8. **Game screen: sync.** When a track ends by itself, the UI switches to Stopped.
9. **Game screen: wake lock and keys.** The screen stays awake on the Game screen. Space and the arrow keys work on desktop.
10. **Export and import.** Export all, reset all data, then import: the playlists are restored, and the exported file contains no tokens.
11. **Layouts.** Check portrait phone, landscape tablet and desktop: no horizontal scroll, and the big button is easy to hit.
12. **Browsers.** iOS Safari, Chrome for Android, and Chrome or Edge on Windows.

## Current status

- **2026-10-18:**
  - Spec v0.1 written.
  - GitHub Pages enabled; a placeholder `index.html` is live.
  - The owner is setting up the Spotify Developer app, with redirect URI `https://north-lab-kev.github.io/hockey-dj/`.
  - **Next:** implement Phase 1 (MVP) as described in `SPEC.md` §9.
