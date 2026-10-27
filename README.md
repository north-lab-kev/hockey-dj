# Hockey DJ

**Big buttons to play the right song at every stoppage of play.**

Hockey DJ is a lightweight web app for playing music in a hockey arena. Build playlists of Spotify tracks, choose the exact second where each song should start (the chorus, the drop, the hook), then run the game with one Play/Stop button per playlist, on any phone, tablet or computer.

**Live app:** https://north-lab-kev.github.io/hockey-dj/

> **Status:** version 1.1. See [`SPEC.md`](SPEC.md) for the full specification.

---

## Features

- **Up to five game buttons**, one per playlist (warm-up, goal, penalty…), each showing the playlist's name. Tap another button to switch playlists in one tap. Each playlist remembers where it was.
- **Made for a narrow window:** the Game screen fits one side of a Chrome split view (about 220 px wide), a phone held in one hand, or a full screen.
- **Custom start and end times:** each song starts and stops at the moments you choose, set by typing them or by tapping **Mark start** and **Mark end** while listening. At the end, the next song starts.
- **Smart resume:**
  - A song stopped after a few seconds resumes where it left off.
  - A song that already played 20 s, or was stopped more than a minute ago, moves on to the next one. Both times can be changed in Settings.
  - Under each button, the screen shows the song that plays, or whether the next Play will resume or start the next song, and the song after it.
- **Previous and Next** under each button choose the next song. While music plays, they prepare the song that follows, without cutting the current one.
- **Continuous play:** when a song ends, the next song starts at its own start time.
- **Shuffle, on by default:** every song plays once in a random order, then a new order starts. You can switch to the playlist order in Settings.
- **Playlists:**
  - Create, edit, reorder and duplicate playlists.
  - Add songs by searching Spotify, by pasting a Spotify link, or by importing one of your Spotify playlists. A song is never added twice.
- **Export and import** playlists as JSON files, for backups or to move them to another device.
- **English and French**, detected automatically from your browser and switchable at any time.
- **Light and dark themes** that follow your device automatically, or can be forced in Settings.
- **Works everywhere:** Windows, macOS, Android, iPhone and iPad, in any modern browser. Nothing to install, but you can install it as an app if you like.
- **Private by design:** no server and no account. Your data stays in your browser.

## How it works

Hockey DJ is a remote control for Spotify. It tells the Spotify app, running on your phone, tablet or a computer connected to the arena's sound system, what to play and from which second (Spotify Connect, through the Spotify Web API).

On a computer, Hockey DJ can also play the music itself: choose **This browser** as the device, and no Spotify app is needed. Keep the tab open during the game. On Android this mode is experimental, and it isn't available on iPhone or iPad.

```
[ Hockey DJ in your browser ] --(Spotify Web API)--> [ Spotify app ] --> [ Arena speakers ]
```

The app is a set of static files hosted on GitHub Pages. You sign in to Spotify directly, using OAuth with PKCE, and your playlists are stored in your browser's local storage.

## Requirements

- A **Spotify Premium** account.
- The **Spotify app open** on the device that plays the sound, unless you play in the browser on a computer.
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

Create a playlist, add songs, and set each song's start time, and an end time if you want. Use **Preview** with **Mark start** and **Mark end** to find the best moments. Under **Game button**, pick the button (1 to 5) that plays this playlist.

### 4. Game time

Open the **Game** screen and tap a playlist's button at each stoppage, then tap it again when the puck drops. The screen stays awake while the Game screen is open. On a computer, `1` to `5` tap the buttons, `Space` plays or stops the last one used, and `←` / `→` choose the previous or next song.

**Tips**
- Turn off **Autoplay** in the Spotify app settings, so Spotify never adds songs of its own.
- **Install it as an app** for a full-screen window with its own icon: **Install** in the address bar of Chrome or Edge, or **Add to Home Screen** on Android and iPhone. On iPhone, the installed app has its own storage: connect again there, and use export and import to bring your playlists.
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
