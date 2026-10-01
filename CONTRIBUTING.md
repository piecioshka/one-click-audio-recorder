# Contributing

<!-- prettier-ignore-start -->

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Code style: Prettier](https://img.shields.io/badge/code_style-Prettier-F7B93E?logo=prettier&logoColor=white)](https://prettier.io/)

<!-- prettier-ignore-end -->

Notes for working on OneClick Audio Recorder from source. The domain language (recording, microphone, recorder backend...) is defined in [CONTEXT.md](CONTEXT.md).

## Project Structure

| Path                                   | What it does                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `index.js`                             | Electron entry point: hides the app from the Dock and starts the tray.        |
| `src/config.js`                        | App name, debug flag and tray icon paths (packaged and from source).          |
| `src/features/tray.feature.js`         | Tray icon, clicks, context menu and error dialogs.                            |
| `src/features/tray-menu.js`            | Builds the context menu template from state (no Electron calls, unit tested). |
| `src/features/settings-store.js`       | Persists microphone, output format and output folder in `settings.json`.      |
| `src/features/microphone-selection.js` | Maps the saved microphone selection to a device from the current list.        |
| `src/features/recorder/`               | The recorder and its two backends (see below).                                |
| `scripts/`                             | Icon generation and marketing image rendering.                                |
| `CONTEXT.md`                           | Glossary of the domain terms used in code and docs.                           |

## How Recording Works

The default `media-recorder` backend opens a hidden window that records the microphone with `getUserMedia` and `MediaRecorder`:

- voice-call processing (echo cancellation, noise suppression, automatic gain control) is turned off, so the file keeps the raw signal,
- audio is captured as lossless PCM in WebM (Opus where PCM is not supported),
- chunks are streamed to a temporary file every second instead of being kept in memory,
- after stop, the bundled `ffmpeg` converts the temporary file to WAV or MP3.

The `avfoundation` backend (macOS only, `RECORDER_BACKEND=avfoundation`) lets `ffmpeg` record straight from AVFoundation. It is not the default because ffmpeg drops whole audio buffers from microphones running at 96 kHz (e.g. the built-in MacBook Pro microphone) and loses more than half of the sound.

## Security

- Packaged builds have [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) flipped in `electron-builder.json5`: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are ignored and the app only loads from a verified `app.asar`. A packaged binary can no longer be used as a plain Node.js runtime, so debug packaging issues with `npm start` or an unpacked `--dir` build and its logs.
- The hidden recorder window has `contextIsolation`, no Node.js integration and a Content Security Policy that allows only its own script (`media-recorder.renderer.js`); keep scripts out of the HTML.

## Requirements

- Node.js 24+ (see `.nvmrc`)
- npm

## Run

```bash
npm install
npm start
```

`npm run dev` starts the app with nodemon and restarts it whenever `index.js` or a `.js`/`.html` file in `src/` changes.

Environment variables for development:

- `RECORDER_DEBUG=1` logs the detected microphones and the selected one.
- `RECORDER_BACKEND=avfoundation` records on macOS with ffmpeg's AVFoundation input instead of the default `media-recorder` backend. It drops audio from microphones running at 96 kHz.

## Tests

```bash
npm test
```

Unit tests use the built-in `node:test` runner and do not start Electron.

## Build

```bash
npm run build
```

Default build command runs icon generation and `electron-builder`.

### Build Per Platform

```bash
npm run build:mac
npm run build:linux
npm run build:win
```

### Build All Platforms

```bash
npm run build:all
```

### Graphics / Icons Pipeline

```bash
npm run icons:generate
```

The script reads `icons/app-icon.png` (1024x1024, also used as the Linux icon) and writes:

- `app-icon.ico` (Windows),
- `app-icon.icns` (macOS).

Both are resized with `sips` and `iconutil`, so they are generated on macOS only and committed. On Linux and Windows the script keeps the committed `app-icon.ico` and skips `app-icon.icns`.

`icons/app-icon-source.svg` is the vector original of the app icon. After editing it, export it to `app-icon.png` and regenerate the icons:

```bash
rsvg-convert -w 1024 -h 1024 icons/app-icon-source.svg -o icons/app-icon.png
npm run icons:generate
```

The tray icons (`tray-icon.png`, `tray-icon-recording.png`, 16x16) are separate files, not produced by this script.

## CI

GitHub Actions workflow `.github/workflows/build-all-platforms.yml` checks formatting, lints, runs the tests and builds artifacts on native runners:

- `macos-latest` -> `npm run build:mac`
- `ubuntu-latest` -> `npm run build:linux`
- `windows-latest` -> `npm run build:win`

## Release

```bash
npm version patch
git push --follow-tags
```

`npm version` bumps `package.json` and creates the `vX.Y.Z` tag. A pushed tag runs the same builds, then the `release` job checks that the tag matches the `package.json` version and publishes the installers from all three platforms as a GitHub release.

## Formatting and Linting

```bash
npm run format:check
npm run format
npm run lint
```

CI checks formatting with Prettier and lints with ESLint (`eslint.config.mjs`). A husky pre-commit hook runs both on staged files through lint-staged; it is installed by `npm install`.

## Marketing Assets

```bash
npm run marketing:render
```

Renders the images used by the README and the repository page into `assets/`:

- `demo.gif` - animated demo (left click to record, right click menu),
- `demo-poster.png` - a still frame of the demo, shown in the README and linking to the GIF,
- `social-preview.png` - 1280x640 card for the repository social preview.

The scenes are plain HTML in `scripts/marketing/` rendered offscreen by Electron and encoded with the bundled `ffmpeg`. The menu labels in `demo.html` mirror `src/features/tray-menu.js`, so update both when the menu changes. The social preview is uploaded by hand in the repository Settings > General > Social preview (GitHub has no API for it).
