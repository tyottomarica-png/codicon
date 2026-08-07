import type { ControllerStatus, GamepadSnapshot, TargetState } from "../types/codicon";
import type { SessionConnection } from "../hooks/useAgentSession";

type Props = {
  connection: SessionConnection;
  gamepad: GamepadSnapshot;
  controller: ControllerStatus;
  target: TargetState;
  workspace: string;
  onWorkspace(): void;
  onCycleTarget(): void;
};

const CONNECTION_LABELS: Record<SessionConnection, string> = {
  ready: "AGENT ONLINE",
  preview: "DESIGN PREVIEW",
  error: "AGENT OFFLINE",
  unavailable: "AGENT UNAVAILABLE",
  connecting: "CONNECTING",
};

export function StatusBar({ connection, gamepad, controller, target, workspace, onWorkspace, onCycleTarget }: Props) {
  const gamepadLabel = !controller.available ? "INPUT OFFLINE" : gamepad.connected ? "PAD READY" : "NO GAMEPAD";
  const gamepadTitle = !controller.available
    ? `Controller input unavailable: ${controller.reason || "unknown"}`
    : gamepad.id || "No controller";
  const sourceLabel = target.source === "manual" ? "MANUAL" : target.source === "auto" ? `AUTO · ${target.app || "?"}` : target.source === "sticky" ? "AUTO · LAST" : "DEFAULT";
  return (
    <header className="status-bar">
      <div className="wordmark"><span className="wordmark-mark">C</span><span>CODICON</span><small>CONTROL SURFACE</small></div>
      <button className="workspace-pill" onClick={onWorkspace} title={workspace}>
        <span className="status-dot" />
        <span className="workspace-label">{workspace.split(/[\\/]/).filter(Boolean).at(-1) || workspace}</span>
      </button>
      <div className="status-cluster">
        <button
          className={`target-badge target-${target.target}`}
          onClick={onCycleTarget}
          title={`操作対象を切り替え (VIEW ボタン) — 現在: ${target.target} / ${sourceLabel}`}
        >
          <i />
          <strong>{target.target === "claude" ? "CLAUDE" : "CODEX"}</strong>
          <small>{sourceLabel}</small>
        </button>
        <span className={`connection-state state-${connection}`}><i />{CONNECTION_LABELS[connection]}</span>
        <span className={`gamepad-state ${gamepad.connected ? "is-connected" : ""} ${controller.available ? "" : "is-offline"}`} title={gamepadTitle}>
          <span className="gamepad-glyph">⌁</span>{gamepadLabel}
        </span>
        {controller.available && controller.backgroundEvents && (
          <span className="background-badge" title="Controller input keeps working while another application is in the foreground">BG</span>
        )}
      </div>
    </header>
  );
}
