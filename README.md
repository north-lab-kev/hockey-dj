# Hockey DJ

**One big button to play the right song at every stoppage of play.**

Hockey DJ is a lightweight web app for playing music in a hockey arena. Build playlists of Spotify tracks, choose the exact second where each song should start (the chorus, the drop, the hook), then run the game with a single Play/Stop button that works on any phone, tablet or computer.

**Live app:** https://north-lab-kev.github.io/hockey-dj/

> **Status:** Phase 1 (MVP) is implemented and in testing. See [`SPEC.md`](SPEC.md) for the full specification.

---

## Features

- **Big Play/Stop button** designed for one-handed use during a game.
- **Custom start times:** each song starts at the moment you choose, set by typing it, nudging by ±1/±5 s, or tapping **Mark here** while listening.
- **Smart resume:**
  - A song stopped after a few seconds resumes where it left off.
  - A song that already played 20 s, or was stopped more than a minute ago, moves on to the next one.
  - The screen always shows whether the next Play will be "Resume" or "Next".
- **Continuous play:** when a song ends, the next song in your playlist starts at its own start time.
- **Playlists:**
  - Create, edit, reorder and duplicate playlists.
  - Add songs by searching Spotify or by pasting a Spotify link.
- **Export and import** playlists as JSON files, for backups or to move them to another device.
- **English and French**, detected automatically from your browser and switchable at any time.
- **Light and dark themes** that follow your device automatically, or can be forced in Settings.
- **Works everywhere:** Windows, macOS, Android, iPhone and iPad, in any modern browser. Nothing to install.
- **Private by design:** no server and no account. Your data stays in your browser.

## How it works

Hockey DJ is a remote control for Spotify. It does not play audio itself. It tells the Spotify app, running on your phone, tablet or a computer connected to the arena's sound system, what to play and from which second (Spotify Connect, through the Spotify Web API).

```
[ Hockey DJ in your browser ] --(Spotify Web API)--> [ Spotify app ] --> [ Arena speakers ]
```

The app is a set of static files hosted on GitHub Pages. You sign in to Spotify directly, using OAuth with PKCE, and your playlists are stored in your browser's local storage.

## Requirements

- A **Spotify Premium** account.
- The **Spotify app open** on the device that plays the sound.
- A modern browser: current Chrome, Edge, Firefox or Safari.
- An internet connection.

## Getting started

### 1. Create a Spotify app (one time)

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in with your Premium account.
2. Click **Create app** and fill in:
   - **App name:** `Hockey DJ`. **Description:** anything.
   - **Redirect URI:** `https://north-lab-kev.github.io/hockey-dj/`. It must match exactly, including the trailing slash.
   - **APIs:** check **Web API** and **Web Playback SDK**.
3. Accept the terms and click **Save**.
4. Open **Settings** and copy the **Client ID**. You will not need the Client Secret; never share it.

### 2. Connect

1. Open https://north-lab-kev.github.io/hockey-dj/
2. Paste your **Client ID** and tap **Connect to Spotify**.
3. Open the Spotify app on the device that will play the music, then select it in Hockey DJ.

### 3. Build a playlist

Create a playlist, add songs, and set each song's start time. Use **Preview** and **Mark here** to find the best moment.

### 4. Game time

Open the **Game** screen and tap **PLAY** at each stoppage, then **STOP** when the puck drops. The screen stays awake while the Game screen is open.

**Tips**
- Turn off **Autoplay** in the Spotify app settings, so Spotify never adds songs of its own.
- On phones and tablets, use your browser's **Add to Home Screen** for a full-screen, app-like experience.
- **Export** your playlists regularly. Data is stored per browser and per device.

## Privacy

- **Stays on your device:** your Client ID, Spotify session and playlists are stored only in your browser's local storage.
- **Goes to Spotify only:** the app makes no requests anywhere except to Spotify.
- **Exports are safe to share:** exported files contain your playlists only, never your Spotify session.
- **Clearing your data:** **Settings → Reset all data** removes everything.

## Development

The app is plain HTML, CSS and JavaScript, with no build step.

- [`SPEC.md`](SPEC.md) describes what the app does and why: requirements, behaviour and technical decisions.
- [`CLAUDE.md`](CLAUDE.md) describes how to work on it: conventions, local setup, deployment and testing.

## Disclaimer

Hockey DJ is a personal, non-commercial project. It runs in Spotify's Development Mode, which is meant for personal use. Playing music publicly in a venue requires the appropriate public-performance licences, which are usually held by the venue (for example SOCAN and Ré:Sonne in Canada).

Spotify is a trademark of Spotify AB. This project is not affiliated with, endorsed by, or sponsored by Spotify.
