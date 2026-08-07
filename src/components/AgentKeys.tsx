import { chatStatus, deriveTitle } from "../hooks/useChats";
import type { Chat, ChatStatus } from "../hooks/useChats";
import type { AgentProvider } from "../types/codicon";

type Props = {
  chats: Chat[];
  activeChatId: string | null;
  canOpen: Record<AgentProvider, boolean>;
  onSelect(chatId: string): void;
  onClose(chatId: string): void;
  onNew(provider: AgentProvider): void;
};

const STATUS_LABELS: Record<ChatStatus, string> = {
  idle: "READY",
  thinking: "THINKING",
  running: "RUNNING",
  waiting: "NEEDS YOU",
  done: "UNREAD",
  error: "ERROR",
};

/**
 * The Agent Keys rail: every live chat at once, each carrying its own status colour, so you can
 * tell what each agent is doing before switching to it.
 */
export function AgentKeys({ chats, activeChatId, canOpen, onSelect, onClose, onNew }: Props) {
  return (
    <section className="agent-keys">
      <div className="rail-title"><span>AGENTS</span><small>{chats.length} ACTIVE</small></div>
      <div className="agent-key-list">
        {chats.map((chat, index) => {
          const status = chatStatus(chat);
          return (
            <div key={chat.id} className={`agent-key status-${status} provider-${chat.provider} ${chat.id === activeChatId ? "is-active" : ""}`}>
              <button className="agent-key-main" onClick={() => onSelect(chat.id)} title={`${chat.provider.toUpperCase()} — ${STATUS_LABELS[status]}`}>
                <span className="agent-key-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="agent-key-lamp" aria-hidden />
                <span className="agent-key-body">
                  <strong>{deriveTitle(chat)}</strong>
                  <small>{chat.provider === "claude" ? "CLAUDE" : "CODEX"} · {STATUS_LABELS[status]}</small>
                </span>
              </button>
              <button className="agent-key-close" onClick={() => onClose(chat.id)} aria-label="Close chat" title="Close chat">×</button>
            </div>
          );
        })}
        {!chats.length && <p className="rail-empty">No agents running.</p>}
      </div>
      <div className="agent-key-new">
        {(["codex", "claude"] as AgentProvider[]).map((provider) => (
          <button key={provider} disabled={!canOpen[provider]} onClick={() => onNew(provider)} title={canOpen[provider] ? `Start a ${provider} chat` : `${provider} is unavailable`}>
            + {provider === "claude" ? "CLAUDE" : "CODEX"}
          </button>
        ))}
      </div>
    </section>
  );
}
