# Next steps

This is the backlog of upcoming work and ideas for Hockey DJ. Nothing in this file is decided yet. Decisions are recorded in [`SPEC.md`](SPEC.md); the process for moving an item from here into the spec is in [`CLAUDE.md`](CLAUDE.md).

Each item lists what it brings to the user, the groundwork already prepared in the spec, and the questions to settle with the owner before building it.

## Phase 2 candidates

### Fade-out on Stop

**Value:** the music fades out over a moment instead of cutting abruptly when play resumes.

**Groundwork:**
- Uses `PUT /me/player/volume`, which is already listed in SPEC §3.3.
- It only works on devices that report `supports_volume`. iPhones often do not (SPEC §10), so the fade must be skipped there.
- The original volume has to be restored before the next Play.
- Keep the number of volume steps small, to stay well inside Spotify's request limits.

**To decide:**
- How long the fade lasts (for example 1 to 2 seconds).
- Whether the button switches to Stopped immediately, or only once the fade is over.

### Shuffle mode

**Value:** songs play in a random order instead of the playlist order.

**To decide:**
- Shuffle once per game, or reshuffle at every pass through the list.
- How it works with automatic continuation (R-5), Previous and Next (R-7).
- Whether the shuffled order is kept after a page reload (R-10).

### Import from a Spotify playlist

**Value:** add the songs of an existing Spotify playlist in one step, instead of searching for them one by one.

**Groundwork:**
- Needs the `playlist-read-private` and `playlist-read-collaborative` scopes (SPEC §3.2). Adding them means the user must reconnect once.
- Uses `GET /me/playlists` and `GET /playlists/{id}/items` (SPEC §3.3).
- Spotify returns the contents only for playlists the user owns or collaborates on.
- Imported songs start at 0:00 (P-9).

**To decide:**
- Import into a new Hockey DJ playlist, or append to an existing one.

### Home-screen install

**Value:** the app opens full screen from its own icon on phones and tablets, like an installed app.

**Groundwork:**
- Needs `manifest.json` and an icon (SPEC §6).
- iOS also expects a PNG `apple-touch-icon`.

**To decide:**
- The short name shown under the icon.
- The icon design: the face-off mark already used as the logo is the obvious candidate.

### In-browser playback on desktop

**Value:** on a computer, the browser itself plays the music, without opening the Spotify app.

**Groundwork:**
- Uses the Spotify Web Playback SDK, loaded from `https://sdk.scdn.co/spotify-player.js`. This is the only allowed dependency (NF-8).
- Needs the `streaming`, `user-read-email` and `user-read-private` scopes (SPEC §3.2), so the user must reconnect once.
- The browser then appears as one more device in the device picker.
- Mobile browsers are not a target for this mode (SPEC §3.4).

**To decide:**
- Whether the browser becomes the default device on desktop, or stays an option in the picker.

## Future ideas (not committed)

- **Song categories:** goal, penalty, intermission or warm-up, each with a quick-access button.
- **Maximum play duration:** an optional limit per song, after which it stops on its own.

Add new ideas from real games to this list as they come up.
