import type { GamepadSnapshot } from "../hooks/useGamepad";

type Props = {
  connection: "connecting" | "ready" | "error" | "preview";
  gamepad: GamepadSnapshot;
  workspace: string;
  onWorkspace(): void;
};

export function StatusBar({ connection, gamepad, workspace, onWorkspace }: Props) {
  const connectionLabel = connection === "ready" ? "CODEX ONLINE" : connection === "preview" ? "DESIGN PREVIEW" : connection === "error" ? "CODEX OFFLINE" : "CONNECTING";
  return (
    <header className="status-bar">
      <div className="wordmark"><span className="wordmark-mark">C</span><span>CODICON</span><small>CONTROL SURFACE</small></div>
      <button className="workspace-pill" onClick={onWorkspace} title={workspace}>
        <span className="status-dot" />
        <span className="workspace-label">{workspace.split(/[\\/]/).filter(Boolean).at(-1) || workspace}</span>
      </button>
      <div className="status-cluster">
        <span className={`connection-state state-${connection}`}><i />{connectionLabel}</span>
        <span className={`gamepad-state ${gamepad.connected ? "is-connected" : ""}`} title={gamepad.id || "No controller"}>
          <span className="gamepad-glyph">⌁</span>{gamepad.connected ? "XBOX READY" : "NO GAMEPAD"}
        </span>
      </div>
    </header>
  );
}
