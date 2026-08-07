import { useEffect, useRef } from "react";
import type { ActivityItem, Chat } from "../hooks/useChats";

type Props = {
  chat: Chat | null;
  assistantLabel: string;
};

function lastReply(chat: Chat | null): string {
  if (!chat) return "";
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    if (chat.messages[index].role === "assistant") return chat.messages[index].text;
  }
  return "";
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <div className="readout-activity-row">
      <i className={`activity-dot status-${item.status}`} />
      <strong>{item.title}</strong>
      <span>{item.detail}</span>
    </div>
  );
}

/**
 * What the selected agent is doing, at a glance — not a transcript.
 *
 * Codicon is a control surface, so it deliberately does not host the conversation: you read and
 * write in Codex or Claude Code. This shows only what the lamps cannot: the tool calls in flight
 * and the tail of the latest reply, so you can tell whether to look over.
 */
export function AgentReadout({ chat, assistantLabel }: Props) {
  const tailRef = useRef<HTMLParagraphElement>(null);
  const reply = lastReply(chat);

  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [reply]);

  const running = chat?.activity.filter((item) => item.status === "running") || [];
  const recent = chat?.activity.slice(0, 6) || [];

  return (
    <section className="agent-readout">
      <div className="panel-heading">
        <span>{assistantLabel} / READOUT</span>
        <i />
        <small>{chat?.activeTurnId ? (running.length ? `${running.length} RUNNING` : "THINKING") : "IDLE"}</small>
      </div>
      <div className="readout-activity">
        {!recent.length && <p className="rail-empty">Tool activity appears here while the agent works.</p>}
        {recent.map((item) => <ActivityRow key={item.id} item={item} />)}
      </div>
      <div className="readout-tail">
        <span className="readout-tail-label">LATEST REPLY</span>
        <p ref={tailRef}>{reply || "—"}</p>
      </div>
    </section>
  );
}
