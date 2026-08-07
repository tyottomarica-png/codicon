import type { ControllerStatus, GamepadSnapshot } from "../types/codicon";

type Props = {
  connection: "connecting" | "ready" | "error" | "preview";
  gamepad: GamepadSnapshot;
  controller: ControllerStatus;
  workspace: string;
  onWorkspace(): void;
};

export function StatusBar({ connection, gamepad, controller, workspace, onWorkspace }: Props) {
  const connectionLabel = connection === "ready" ? "CODEX ONLINE" : connection === "preview" ? "DESIGN PREVIEW" : connection === "error" ? "CODEX OFFLINE" : "CONNECTING";
  const gamepadLabel = !controller.available ? "INPUT OFFLINE" : gamepad.connected ? "XBOX READY" : "NO GAMEPAD";
  const gamepadTitle = !controller.available
    ? `Controller input unavailable: ${controller.reason || "unknown"}`
    : gamepad.id || "No controller";
  return (
    <header className="status-bar">
      <div className="wordmark"><span className="wordmark-mark">C</span><span>CODICON</span><small>CONTROL SURFACE</small></div>
      <button className="workspace-pill" onClick={onWorkspace} title={workspace}>
        <span className="status-dot" />
        <span className="workspace-label">{workspace.split(/[\\/]/).filter(Boolean).at(-1) || workspace}</span>
      </button>
      <div className="status-cluster">
        <span className={`connection-state state-${connection}`}><i />{connectionLabel}</span>
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
