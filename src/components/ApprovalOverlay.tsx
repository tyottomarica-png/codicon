import type { ApprovalRequest } from "../hooks/useCodexSession";

type Props = {
  request: ApprovalRequest;
  onDecision(decision: "accept" | "acceptForSession" | "decline" | "cancel"): void;
};

export function ApprovalOverlay({ request, onDecision }: Props) {
  return (
    <div className="overlay-backdrop approval-backdrop" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <div className="approval-card">
        <div className="approval-kicker"><span>SAFETY CHECK</span><i /></div>
        <h2 id="approval-title">{request.title}</h2>
        <p>{request.reason}</p>
        <pre>{request.command}</pre>
        <div className="approval-actions">
          <button className="button-ghost" onClick={() => onDecision("decline")}><kbd>B</kbd>拒否</button>
          <button className="button-secondary" onClick={() => onDecision("acceptForSession")}>セッション中許可</button>
          <button className="button-primary" onClick={() => onDecision("accept")}><kbd>A</kbd>今回のみ許可</button>
        </div>
      </div>
    </div>
  );
}
