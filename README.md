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

## Background operation

Codicon reads the controller in the Electron main process through SDL rather than through the browser Gamepad API, which only reports to a focused document. Every control above therefore keeps working while the Codex CLI, Claude Code, or any other application owns the foreground.

- A compact always-on-top overlay shows the active model, reasoning effort, and whether the turn is working, listening, or waiting for approval. It never takes focus, floats above macOS fullscreen spaces, and remembers where you drag it.
- A menu bar item (tray on Linux) reports controller state and reopens the window.
- Closing the window leaves the session running in the background; quit from the menu bar. Set **Close window quits Codicon** in Settings for the old behaviour.

The status bar shows a `BG` badge while background input is live, and `INPUT OFFLINE` with the reason if SDL could not start. On macOS you may need to allow Codicon under **System Settings → Privacy & Security → Input Monitoring**. macOS 15.4 shipped a regression that broke background controller input; [Apple fixed it in 15.5](https://developer.apple.com/forums/thread/780929).

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

Download the build for your platform from [GitHub Releases](https://github.com/kloysova/codicon/releases).

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

The UI can also be opened without Electron using `npm run dev`'s Vite URL; it then runs in design-preview mode, does not execute Codex actions, and has no controller input, since the controller is read by the main process. Append `?view=hud` to that URL to work on the overlay in the browser.

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

`dist:mac` produces DMG/ZIP for the architecture of the machine it runs on. The SDL controller binding is a prebuilt native binary fetched per architecture at install time, so macOS builds cannot be cross-compiled; the included GitHub Actions workflow builds Linux, macOS arm64, and macOS x64 on their own native runners when a `v*` tag is pushed or the workflow is started manually.

The same constraint is why `npmRebuild` is disabled in the electron-builder config: `@kmamal/sdl` ships a Node-API binary that is already ABI-compatible with Electron, and its build toolchain is not part of the dependency tree.

Unsigned local builds can be opened manually. For distribution to other people, configure an Apple Developer ID and notarization for macOS. Add maintainer/homepage metadata before introducing a `.deb` target; the default Linux artifact is the portable AppImage.

Pushing a version tag such as `v0.1.2` runs the native Linux and macOS packaging jobs and publishes their outputs to GitHub Releases. The workflow can also be started manually to produce Actions artifacts without creating a release.

## Architecture

- `electron/main.cjs` starts `codex app-server` over JSONL stdio, owns privileged filesystem/process access, and forwards a narrow IPC surface.
- `electron/preload.cjs` exposes only the operations used by the renderer; Node integration remains disabled.
- `electron/gamepadSource.cjs` reads the controller over SDL at 60 Hz with background events enabled, and `electron/gamepadMapper.cjs` is the pure state machine that turns raw samples into edge-triggered actions with deadzone filtering and haptic ticks.
- `src/hooks/useGamepad.ts` subscribes to those actions over IPC; the renderer does no polling, so losing focus and Chromium's background throttling cannot stall the controller.
- `src/lib/audio.ts` converts microphone samples to 24 kHz mono PCM16 frames for `thread/realtime/appendAudio`.
- The renderer follows the app-server thread/turn/item lifecycle and handles command/file approval requests explicitly.

Realtime voice and `thread/settings/update` are currently experimental Codex app-server surfaces. Codicon enables the `realtime_conversation` feature when it starts app-server and presents failures without silently falling back to a separate API key.

## Safety

The default permission preset is **Auto** (`workspace-write` with `on-request` approvals). Approval requests are shown in a modal that maps A to one-time approval and B to decline. Full Access is only selectable in Settings and is never activated by the model ring.

## License

[MIT](LICENSE)
