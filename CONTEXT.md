# OneClick Audio Recorder

A tray app that records the microphone with one click and saves the file to a folder.

## Language

**Recording**:
One capture from the moment the user starts it in the tray until they stop it, saved as a single file.
_Avoid_: session, take

**Microphone**:
An audio input device the app can record from. The list comes from the active recorder backend.
_Avoid_: interface, input

**Microphone selection**:
The microphone the user picked in the tray menu, or the system default when they picked none.

**Selector**:
The persisted reference to a microphone selection (`settings.inputDeviceId`), e.g. `label:USB Mic`. `null` means the system default.

**Output format**:
The file format of a saved recording: `wav` (default) or `mp3`.

**Output folder**:
The folder where recordings are saved. Falls back to the system Downloads folder when it is not writable.

**Recorder**:
The module that records one microphone into one file (`src/features/recorder`). The tray only calls `start`, `stop` and `refreshDevices` and listens to its events.

**Interrupted recording**:
A recording whose temp WebM was never converted because the app died mid-recording. It is converted into the output folder on the next start; if ffmpeg cannot read it, the raw WebM is moved there instead.
_Avoid_: orphan, leftover

**Recorder backend**:
The way the recorder captures audio: `media-recorder` (default on every platform, a hidden window records with MediaRecorder and ffmpeg converts the result) or `avfoundation` (macOS only, opt-in, ffmpeg records directly).
_Avoid_: native recording, renderer recording
