# Codicon

Codicon is a controller-first desktop control surface for OpenAI Codex. It runs on Linux and macOS, talks to the local Codex CLI through the official `app-server` protocol, and uses the standard Web Gamepad API for Xbox controllers.

日本語の詳しい使い方は [docs/OPERATIONS.ja.md](docs/OPERATIONS.ja.md) を参照してください。

## Controls

| Input | Default action |
| --- | --- |
| Hold **LB** + left stick | Select one of the three model presets |
| Hold **LB** + right stick | Select a supported reasoning effort |
| Release **LB** | Commit both selections |
| Hold **RB** | Push to Talk; speech is sent through Codex realtime voice |
| Click **RS** | Toggle the model's Fast service tier without changing reasoning effort |
| **A** | Send the typed prompt, or approve the current request |
| **B** | Interrupt the active turn, decline an approval, or cancel the ring |
| **X** | Focus the text composer |
| **Y** | Start a fresh session (the old Codex thread remains in history) |
| **Menu** | Open settings |

The model ring is populated from `model/list`; it does not assume that model names or reasoning options will stay fixed. The three directions are presets and can be reassigned in Settings.

## Requirements

- Linux (x64/arm64) or macOS (Apple Silicon/Intel)
- Node.js 22 or newer for development
- A current `codex` CLI available on `PATH`, signed in with `codex login`
- An Xbox-compatible controller using a standard browser gamepad mapping
- Microphone permission for Push to Talk

Check the CLI before starting:

```bash
codex --version
codex doctor
```

## Install

Download the build for your platform from [GitHub Releases](https://github.com/tyottomarica-png/codicon/releases).

### Linux

Download the AppImage, make it executable, and launch it:

```bash
chmod +x Codicon-*-linux-*.AppImage
./Codicon-*-linux-*.AppImage
```

Codicon starts the locally installed `codex` executable. Run `codex login` first if the CLI is not already signed in. Some Linux distributions require FUSE support for AppImage; if it is unavailable, use the AppImage extraction mode or build from source.

### macOS

Download the DMG matching your Mac (`arm64` for Apple Silicon, `x64` for Intel), open it, and move Codicon to Applications. The current community builds are unsigned, so on first launch you may need to Control-click Codicon, choose **Open**, and confirm the prompt in macOS.

Codicon does not bundle Codex credentials or an API key. It uses the local Codex CLI session and only requests microphone access while Push to Talk is active.

## Development

```bash
npm install
npm run dev
```

The UI can also be opened without Electron using `npm run dev`'s Vite URL; it then runs in design-preview mode and does not execute Codex actions.

On Linux, Electron relies on the Chromium sandbox. If an unpackaged development binary reports that `chrome-sandbox` is not configured, configure its root ownership/mode according to Electron's Linux sandbox guidance or run the one-off local validation with `electron --no-sandbox`; do not distribute a launcher that disables the sandbox. GPU-less VMs may additionally need `--disable-gpu` for local validation.

## Verification and packaging

```bash
npm test
npm run typecheck
npm run build
npm run dist:linux   # AppImage
```

Create the macOS artifacts on macOS:

```bash
npm run dist:mac
```

`dist:mac` produces both x64 and arm64 DMG/ZIP variants. The included GitHub Actions workflow builds Linux and macOS artifacts on their native runners when a `v*` tag is pushed or the workflow is started manually.

Unsigned local builds can be opened manually. For distribution to other people, configure an Apple Developer ID and notarization for macOS. Add maintainer/homepage metadata before introducing a `.deb` target; the default Linux artifact is the portable AppImage.

Pushing a version tag such as `v0.1.0` runs the native Linux and macOS packaging jobs and publishes their outputs to GitHub Releases. The workflow can also be started manually to produce Actions artifacts without creating a release.

## Architecture

- `electron/main.cjs` starts `codex app-server` over JSONL stdio, owns privileged filesystem/process access, and forwards a narrow IPC surface.
- `electron/preload.cjs` exposes only the operations used by the renderer; Node integration remains disabled.
- `src/hooks/useGamepad.ts` polls standard gamepads and applies edge-triggered actions, deadzone filtering, and haptic ticks.
- `src/lib/audio.ts` converts microphone samples to 24 kHz mono PCM16 frames for `thread/realtime/appendAudio`.
- The renderer follows the app-server thread/turn/item lifecycle and handles command/file approval requests explicitly.

Realtime voice and `thread/settings/update` are currently experimental Codex app-server surfaces. Codicon enables the `realtime_conversation` feature when it starts app-server and presents failures without silently falling back to a separate API key.

## Safety

The default permission preset is **Auto** (`workspace-write` with `on-request` approvals). Approval requests are shown in a modal that maps A to one-time approval and B to decline. Full Access is only selectable in Settings and is never activated by the model ring.

## License

[MIT](LICENSE)
