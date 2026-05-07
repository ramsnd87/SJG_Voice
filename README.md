# Glitch Studio Builder

Standalone voice-cloning + clip-prep studio. Composes existing engines on this PC; **does not modify** any other project.

## What it talks to

| Service | Where | How Glitch uses it |
|---|---|---|
| EnginSam TTS server | `OneDrive\RAM LOGISTICS SOLUTIONS LLC\EnginSam\tts-server\` (port 8018) | Read-only proxy: `/status`, `/voices`, `/speak` |
| ffmpeg | system `PATH` or `FFMPEG_PATH` env | Slice audio/video into 24 kHz mono WAV references |
| Voice library mirrors | `EnginSam\tts-server\voices` and `SAM_PODCAST\data\voices` | Read-only scan to list every known voice |

Every file Glitch creates lands inside this folder under `data/clips/` or `data/staged_voices/`. It never writes outside its own root.

## Run it

```bat
launcher.bat
```

First run installs dependencies, then boots:

- Vite dev server (`http://127.0.0.1:5193`)
- Node sidecar (`http://127.0.0.1:8044`)
- Electron window

## Panes

- **Voice Lab** — pick any cloned voice, type a line, hear it back (calls EnginSam TTS).
- **Voice Library** — read-only inventory of every voice profile under both library roots.
- **Clip Studio** — pick a media file, set start/duration, get a clean reference WAV.
- **Cast Routing** — locally map slots → voices and copy as JSON to paste into a podcast project.

## Configuration

`config/paths.json` controls scan roots, EnginSam TTS URL, sidecar port, and the RAM logo bug path. Edit there if anything moves.

## What it does NOT do

- Does not edit `SAM_PODCAST/data/voices/`.
- Does not edit `EnginSam/tts-server/voices/`.
- Does not push state into other projects automatically — Cast Routing copies JSON to your clipboard, you paste it.
