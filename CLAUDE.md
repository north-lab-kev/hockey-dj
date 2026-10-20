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
- **New features:** discuss each idea in the conversation.
  1. When the owner picks one, settle its open questions with him.
  2. Write the decisions into `SPEC.md`, then build it.
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
python -m http.server 8000 --bind 127.0.0.1   # use python3 on macOS and Linux
# open http://127.0.0.1:8000/ (not localhost, see SPEC §3.1)
```

- **One-time setup:**
  - Install Python 3 if needed. On Windows: `winget install Python.Python.3.12`, then open a new terminal.
  - Register the local redirect URI from SPEC §3.1 in the Spotify dashboard (app → Settings → Redirect URIs).
- **Claude Code desktop:** `.claude/launch.json` defines the same server under the name `hockey-dj`, so Claude can start it and open the app in the built-in browser.
- **Release a new version:**
  1. Change `APP_VERSION` in `version.js` (for example `1.0` → `1.1`). Without this step, open apps show no update banner (SPEC U-2).
  2. Commit and push to `main`. GitHub Pages republishes within a few minutes (watch the repository's Actions tab).
  3. Users get the new files the next time they open or reload the app (U-1), without clearing the cache. Apps that are already open show the update banner within 30 minutes, or as soon as they come back to the foreground.
- **Commit email:** use the GitHub noreply address, otherwise GitHub rejects the push (GH007): `git config user.email "308231901+north-lab-kev@users.noreply.github.com"`.

## Manual test checklist

There are no automated tests. Before each release, run these scenarios on a phone and on a desktop, and check the expected behaviour against the referenced IDs.

1. **Language:** on first launch the language matches the browser. Switching it in Settings updates every string without a reload, and the header has no language toggle. (I-2, I-4, I-5)
2. **Setup and connection:** enter the Client ID, copy the redirect URI and connect. The URL comes back clean and the display name appears. (F-2 to F-4, §3.2)
3. **Session:** a reload keeps the session. A forced token expiry refreshes silently. (§3.2)
4. **Devices:** test with the Spotify app open, then closed. (F-4, §3.4 error handling)
   - Browser player, with the Spotify app closed: on desktop, "This browser" is selected by default, the first Play makes sound, and Stop, resume, Next, shuffle and automatic continuation work. Reload mid-game, switch to another device and back, and try Firefox. On Android it is listed as experimental and never selected by default. On iPhone it never appears. (B-1 to B-5)
5. **Playlist editing:** search with Load more, every pasted-link format, reorder, remove. Changes survive a reload. (P-1 to P-8)
   - Import a Spotify playlist you own, then import it again: nothing is added twice. Check that followed playlists are not offered, and that local files are skipped. (P-2, P-9)
6. **Start and end:** set each by typing, and with Mark start and Mark end during a preview. Try out-of-range values, an end before the start, a start moved past the end, and clearing the end. The preview stops at the end, and in a game the next track starts there. Import a version 1 export file. (P-4, P-5, P-7, P-10, §5.4)
7. **Play/Stop:** test each branch of R-2 and R-3.
   - Stop below both thresholds, then Play: the track resumes.
   - Stop after reaching the played threshold, then Play: the next track starts.
   - Stop below the played threshold, wait past the idle window, then Play: the next track starts.
   - The label follows R-9, and taps during a pending request are ignored. (R-1 to R-9, G-3)
   - Change both thresholds in Settings (typing, nudges, out-of-range values, Restore defaults), reload, and repeat the branches above with the new values. (S-8)
8. **Continuation:** let a track end by itself, and pause from the Spotify app. (R-5, §3.4)
9. **Explicit selection:** use Previous, Next and tap-to-select, both while Stopped and while Playing. (R-7)
   - Repeat with shuffle on: go past the end of a pass and back with Previous, check that the "Then" card and the list match what plays, reload, then add and remove songs. Turn shuffle off and on during a game. (R-11 to R-14, S-9)
10. **Reload mid-game:** reload the page during a game; the app keeps its place. (R-10)
11. **Wake lock and keyboard:** check that the screen stays on and that the keyboard shortcuts work. (G-8, G-9)
12. **Export, import and reset:** the exported file must contain no tokens. (E-1 to E-4, S-5)
13. **Layouts:** portrait phone, landscape tablet and desktop. (NF-5, §7)
14. **Theme:** on Auto, switch the device between light and dark while the app is open; the app follows live. Force Light, then Dark, and reload: the choice is kept, with no flash of the other theme. (S-7, §7)
15. **Browsers:** every browser listed in SPEC §8.
16. **Installation:** install from Chrome or Edge on desktop and from Add to Home Screen on Android and iOS. Check the name and icon, that it opens full screen, and that connecting to Spotify works inside the installed app. (A-1 to A-4)
17. **Updates:** deploy a change with a new `APP_VERSION`. A normal reload shows it, without clearing the cache. An app left open shows the banner when it comes back to the foreground, and Reload loads the new version. (U-1, U-2)

## Current status

Version 1.0, deployed on GitHub Pages and tested by the owner with the real Spotify API. No questions are awaiting an answer.

**Features**
- Setup and Spotify connection with PKCE (§3.2, §4.1).
- Playback devices, including the browser player: the default on desktop, experimental on Android (§3.4, B-1 to B-5).
- Game screen: Play/Stop with resume or advance, automatic continuation, Previous and Next, wake lock and keyboard shortcuts (§4.2, §4.2.1).
- Shuffle, on by default (§4.2.2).
- Playlists: search, paste a link, import a Spotify playlist without duplicates, start and end of each song with Mark start and Mark end, preview, reorder (§4.3).
- Export, import and reset (§4.4, S-5).
- Settings: language, theme, Spotify connection, device, play order and the two R-2 thresholds (§4.5).
- English and French (§4.6), light and dark themes (§7).
- Installation as an app (§4.7).
- Updates: latest files on every load, and an update banner while open (§4.8).
