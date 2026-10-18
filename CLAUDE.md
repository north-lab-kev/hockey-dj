# CLAUDE.md

How to work in this repository. Read this file first, then [`SPEC.md`](SPEC.md).

## Documentation map

Each document has one responsibility. Never copy content from one file into another. Link to the section or requirement ID instead (for example "SPEC §3.3" or "R-2").

| File | Owns | Audience |
|---|---|---|
| `README.md` | Project overview, end-user setup guide, privacy notes | Visitors and end users |
| `SPEC.md` | **What** the app does and **why**: requirements (with IDs), behaviour rules, Spotify integration, data model, architecture and module boundaries, phases, known limitations, spec changelog. **Final decisions only.** | Everyone, source of truth |
| `CLAUDE.md` | **How** to work: working agreements, coding conventions, Spotify API process, local development and deployment, manual test procedure, current status | Developers and Claude |

## Working agreements

- **Language:** the project owner writes in French, so reply to him in French. Repository content follows SPEC NF-9.
- **Spec first:** read the relevant SPEC sections before changing code. Ask before building anything that is not in the spec, and propose spec changes explicitly.
- **Only decisions go in the spec:** ask open questions in the conversation, and list any awaiting an answer under [Current status](#current-status). Once the owner decides, write the decision into the relevant SPEC requirement. Never record questions, alternatives or "resolved" notes in `SPEC.md`.
- **Keep SPEC.md current:** any change to behaviour, requirements or technical decisions updates `SPEC.md` in the same change. Bump its version and add a Changelog entry (SPEC §12).
- **Keep README.md current:** update it when a phase ships or a user-visible behaviour changes. Keep it user-facing and short.
- **Keep this file current:** update [Current status](#current-status) at the end of each working session.
- **Delivery:** the file layout follows SPEC NF-10.
  - From a chat, list exactly which files changed. The owner uploads them through the GitHub web UI (Add file → Upload files).
  - With Claude Code on the web, changes land on a branch, and the owner merges into `main` to deploy.

## Coding conventions

- **Boundaries:** respect the constraints in SPEC NF-7 and NF-8, and the module boundaries in SPEC §6.
- **JavaScript:**
  - ES2020+ native modules with named exports.
  - `const` by default, and `async`/`await` for asynchronous code.
  - No global variables and no inline `on…` handlers in HTML.
- **Documentation:** a short JSDoc comment on every exported function.
- **Constants:** thresholds, intervals and storage key names go in `UPPER_SNAKE_CASE` at the top of the module that owns them.
- **Security:**
  - Insert any text that comes from Spotify or from imported files with `textContent`, never `innerHTML`.
  - Never log tokens.
- **i18n:**
  - Keys are dot-namespaced by screen (`game.play`, `settings.language`).
  - Add every key to both `en` and `fr` in the same change.
- **CSS:**
  - Custom properties for colours, spacing and radii.
  - Mobile-first `min-width` media queries.
  - Class names in kebab-case.
- **Commits:** short imperative English messages (for example "Add playlist export"), with one logical change per commit.

## Spotify API process

Spotify's Development Mode rules change over time (see SPEC §3.1 and §10).
- **New endpoint:** before using an endpoint that is not listed in SPEC §3.3, check that it is still available in the Spotify Web API changelog. Use the links in SPEC §11 and any newer monthly changelog. Then add the endpoint to SPEC §3.3 with the date it was checked.
- **Something broke:** if a call that used to work starts failing (400, 403 or 404), read the latest changelog before changing the code.
- **New scope:** if a feature needs a new OAuth scope, add it to the scope table in SPEC §3.2. The app then prompts the user to reconnect, as described in that section.

## Local development and deployment

```bash
# from the repository root (ES modules do not load from file://)
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/
```

- **One-time setup:** register the local redirect URI from SPEC §3.1 in the Spotify dashboard (app → Settings → Redirect URIs).
- **Deploy:** commit or merge to `main`. GitHub Pages republishes within a few minutes. Hard-refresh, or use a private window, to bypass the cache.

## Manual test checklist

There are no automated tests. Before each release, run these scenarios on a phone and on a desktop, and check the expected behaviour against the referenced IDs.

1. **Language:** on first launch the language matches the browser. Switching it updates every string without a reload. (I-2, I-4, I-5)
2. **Setup and connection:** enter the Client ID, copy the redirect URI and connect. The URL comes back clean and the display name appears. (F-2 to F-4, §3.2)
3. **Session:** a reload keeps the session. A forced token expiry refreshes silently. (§3.2)
4. **Devices:** test with the Spotify app open, then closed. (F-4, §3.4 error handling)
5. **Playlist editing:** search with Load more, every pasted-link format, reorder, remove. Changes survive a reload. (P-1 to P-8)
6. **Start offset:** set it by typing, with the nudge buttons, and with Mark here during a preview. Try out-of-range values. (P-4, P-7)
7. **Play/Stop:** test each branch of R-2 and R-3.
   - Stop below both thresholds, then Play: the track resumes.
   - Stop after reaching the played threshold, then Play: the next track starts.
   - Stop below the played threshold, wait past the idle window, then Play: the next track starts.
   - The label follows R-9, and taps during a pending request are ignored. (R-1 to R-9, G-3)
8. **Continuation:** let a track end by itself, and pause from the Spotify app. (R-5, §3.4)
9. **Explicit selection:** use Previous, Next and tap-to-select, both while Stopped and while Playing. (R-7)
10. **Reload mid-game:** reload the page during a game; the app keeps its place. (R-10)
11. **Wake lock and keyboard:** check that the screen stays on and that the keyboard shortcuts work. (G-8, G-9)
12. **Export, import and reset:** the exported file must contain no tokens. (E-1 to E-4, S-5)
13. **Layouts:** portrait phone, landscape tablet and desktop. (NF-5, §7)
14. **Theme:** on Auto, switch the device between light and dark while the app is open; the app follows live. Force Light, then Dark, and reload: the choice is kept, with no flash of the other theme. (S-7, §7)
15. **Browsers:** every browser listed in SPEC §8.

## Current status

- **2026-10-18:**
  - All Play/Stop behaviour decisions are final and written into SPEC §4.2.1. No questions are awaiting an answer.
  - The docs were reorganised so that each file has a single responsibility (see the Documentation map).
  - **Phase 1 implemented (app version 0.1.0):** `index.html`, `style.css`, `app.js`, `spotify.js`, `storage.js`, `i18n.js` and `ui.js`.
    - Tested in Chromium against a mocked Spotify (accounts, Web API and images): setup and login, devices, search and paste link, start offsets and Mark here, every branch of R-1 to R-10, keyboard, export and import, errors (404 no device, 403 Premium, expired session, access denied).
    - Tested at 360, 390 and 1366 px, in light and dark, in EN and FR.
    - **Not yet tested against the real Spotify API, or on real iOS and Android devices.**
  - **Next:** the owner deploys and runs the manual test checklist with real Spotify, then Phase 2 (SPEC §9).
