# Codicon

Codicon is a **software control surface** for **Claude Code and OpenAI Codex**, driven by an Xbox-compatible controller. Think of the [Codex Micro macropad](https://openai.com/supply/co-lab/work-louder/): a peripheral, not another window to read in.

Codicon deliberately **does not host the conversation**. There is no chat panel and no composer. What it gives you is what a macropad gives you — with a controller you already own:

- **Agent Keys** — every live agent at once, each with a status lamp (thinking / running / needs-you / unread), so you can see what all of them are doing without switching.
- **A dial for brainpower** — hold LB, push the sticks, pick model and reasoning effort.
- **A joystick for Skills** — hold LT, flick, launch a saved workflow (review a PR, debug, refactor).
- **Command keys** — approve, decline, interrupt, push-to-talk, new agent.

It runs on Linux and macOS and reads the controller at the OS level, so every control keeps working while another application is in the foreground.

## Direct control

By default Codicon drives its own agent sessions (Codex over the official `app-server` protocol, Claude Code over the official Agent SDK). **Direct control** points the same rings at the agent you already have open instead — the physical macropad's behaviour, where a key press lands in whatever is in front of you.

Turn it on in **Settings → Direct control**. Two modes:

| Mode | What happens | Permission |
| --- | --- | --- |
| `clipboard` | The command is placed on your clipboard; you paste it with ⌘V | **none** |
| `type` | The command is typed into the frontmost agent | macOS Accessibility |

`type` also needs the optional native backend: `npm install @jitsi/robotjs` (Node-API, prebuilt for macOS and Linux — no compiler).

The guardrails are structural, not advisory:

- **Off by default.** Nothing is ever sent until you turn it on.
- **One press, one dispatch.** No timers, retries or queues — every send traces to a physical controller edge.
- **The target is re-checked at the moment of sending.** If you alt-tab to a browser or a password manager between choosing on the ring and releasing the trigger, the send is cancelled rather than typed into it.
- **A minimum interval between sends**, so a stuck button cannot become a stream of input.
- Codicon shows exactly what it sent, and why it did not.

What the two CLIs actually accept was measured, not assumed. Claude Code takes an inline argument for `/model`, `/effort` and `/fast`. Codex does **not**: `supports_inline_args()` in `codex-rs/tui/src/slash_command.rs` excludes `Model` and `Permissions`, so `/model` there can only open the picker for you to choose from — Codicon opens it and stops, rather than sending arrow keys that would select the wrong row when the list changes.

日本語の詳しい使い方は [docs/OPERATIONS.ja.md](docs/OPERATIONS.ja.md) を参照してください。

## Controls

| Input | Default action |
| --- | --- |
| Hold **LB** + left stick | Select one of the three model presets |
| Hold **LB** + right stick | Select a supported reasoning effort |
| Release **LB** | Commit both selections |
| Hold **RB** | Push to Talk; speech is sent through Codex realtime voice (Codex target only) |
| Click **RS** | Toggle Fast mode without changing reasoning effort |
| **VIEW** | Switch the target agent (Codex ⇄ Claude Code) |
| Hold **LT** + left stick | Pick a Skill; release to run it against the active agent |
| **A** | Approve the pending request |
| **B** | Interrupt the active turn, decline an approval, or cancel a ring |
| **X** | Bring Codicon to the front |
| **Y** | Start a fresh agent |
| **Menu** | Open settings |

The model ring is populated live from each backend — `model/list` for Codex, `supportedModels()` for Claude Code — so new models appear without an app update. Each backend has its own three presets, reassignable in Settings.

## Two agents, one controller

Codicon runs a session per backend and the controller drives the **active target**:

- **Auto targeting** — a focus tracker watches which application is frontmost. Working in a terminal tab running `claude`? The controller drives the Claude session. Switch to a `codex` tab, and it drives Codex. The Claude desktop app counts as a Claude context. Detection layers: frontmost app (no permissions, via LaunchServices) → active-tab tty and its foreground process (one-time Automation prompt for Terminal/iTerm2) → a global scan of interactive terminal processes when only one agent is running.
- **Manual override** — the VIEW button, the status-bar badge, the menu bar item, or Settings pin the target to one backend.
- The **power ring appears over whatever app you are using**: holding LB while Codicon is in the background opens the same radial selector in a click-through, always-on-top overlay centred on your display, driven entirely by the sticks.

Feature mapping per backend:

| | Codex | Claude Code |
| --- | --- | --- |
| Model ring | `model/list` | `supportedModels()` (Fable / Opus / Sonnet / Haiku…) |
| Effort ring | reasoning efforts from the model | `low / medium / high / xhigh / max` |
| Fast toggle | `priority` service tier | `/fast` flag setting (Opus models) |
| Approvals | app-server approval requests | `canUseTool` permission callback |
| Voice (RB) | realtime voice API | not available |
| Interrupt | `turn/interrupt` | `interrupt()` control request |
| Sessions | app-server threads | `~/.claude` sessions, resumable |

Claude Code uses your existing `claude login` (subscription); Codex uses your existing `codex login`. Codicon never handles API keys.

## Background operation

Codicon reads the controller in the Electron main process through SDL rather than through the browser Gamepad API, which only reports to a focused document. Every control above therefore keeps working while the Codex CLI, Claude Code, or any other application owns the foreground.

- A compact always-on-top overlay shows the active model, reasoning effort, and whether the turn is working, listening, or waiting for approval. It never takes focus, floats above macOS fullscreen spaces, and remembers where you drag it.
- A menu bar item (tray on Linux) reports controller state and reopens the window.
- Closing the window leaves the session running in the background; quit from the menu bar. Set **Close window quits Codicon** in Settings for the old behaviour.

The status bar shows a `BG` badge while background input is live, and `INPUT OFFLINE` with the reason if SDL could not start. On macOS you may need to allow Codicon under **System Settings → Privacy & Security → Input Monitoring**. macOS 15.4 shipped a regression that broke background controller input; [Apple fixed it in 15.5](https://developer.apple.com/forums/thread/780929).

## Requirements

- Linux (x64/arm64) or macOS (Apple Silicon/Intel)
- Node.js 22 or newer for development
- For the Codex backend: a current `codex` CLI on `PATH`, signed in with `codex login`
- For the Claude Code backend: signed in with `claude login` (the CLI binary itself ships with the app via the Agent SDK)
- An Xbox-compatible controller
- Microphone permission for Push to Talk (Codex voice)

Either backend alone is enough — the other simply shows as unavailable with the reason.

Check the CLIs before starting:

```bash
codex --version
claude --version
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

- `electron/agents/codexAgent.cjs` speaks the `codex app-server` JSONL protocol; `electron/agents/claudeAgent.cjs` drives a streaming-input Claude Agent SDK session per thread. Both translate their native streams into one provider-neutral event schema, so the renderer cannot tell the backends apart.
- `electron/focusTracker.cjs` detects the frontmost app and, for terminals, the active tab's foreground process, to auto-select the target backend.
- `electron/gamepadSource.cjs` reads the controller over SDL at 60 Hz with background events enabled, and `electron/gamepadMapper.cjs` is the pure state machine that turns raw samples into edge-triggered actions with deadzone filtering and haptic ticks.
- `electron/main.cjs` owns the windows (main, status HUD, wheel overlay), the tray, target resolution, and a narrow provider-parameterized IPC surface; `electron/preload.cjs` exposes only those operations.
- `src/hooks/useAgentSession.ts` holds one session's state per backend, driven purely by the normalized events; `src/hooks/useGamepad.ts` subscribes to controller actions — the renderer does no polling, so losing focus and Chromium's background throttling cannot stall the controller.
- `src/lib/audio.ts` converts microphone samples to 24 kHz mono PCM16 frames for Codex `thread/realtime/appendAudio`.

Realtime voice and `thread/settings/update` are currently experimental Codex app-server surfaces. Codicon enables the `realtime_conversation` feature when it starts app-server and presents failures without silently falling back to a separate API key.

## Safety

The default permission preset is **Auto** — `workspace-write` with `on-request` approvals on Codex, and the default permission mode with a `canUseTool` prompt on Claude Code. Approval requests from either backend are shown in the same modal, mapping A to one-time approval and B to decline. **Read Only** maps to Codex's read-only sandbox and Claude Code's plan mode. **Full Access** (`danger-full-access` / `bypassPermissions`) is only selectable in Settings and is never activated by the model ring.

## License

[MIT](LICENSE)
