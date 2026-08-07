import { useEffect, useRef } from "react";
import type { ChatMessage } from "../hooks/useAgentSession";
import { MicIcon, SparkIcon, StopIcon } from "./Icons";

type Props = {
  messages: ChatMessage[];
  value: string;
  busy: boolean;
  voiceActive: boolean;
  voiceSupported: boolean;
  assistantLabel: string;
  liveTranscript: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange(value: string): void;
  onSend(): void;
  onInterrupt(): void;
  onVoiceStart(): void;
  onVoiceStop(): void;
};

export function ChatPanel({ messages, value, busy, voiceActive, voiceSupported, assistantLabel, liveTranscript, inputRef, onChange, onSend, onInterrupt, onVoiceStart, onVoiceStop }: Props) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveTranscript]);

  return (
    <section className="chat-panel">
      <div className="panel-heading"><span>SESSION / LIVE</span><i /> <small>{busy ? "AGENT RUNNING" : "READY FOR INPUT"}</small></div>
      <div className="transcript" ref={transcriptRef}>
        {!messages.length && (
          <div className="empty-session">
            <SparkIcon />
            <h2>What should we build?</h2>
            <p>{voiceSupported ? "RBを押しながら話すか、キーボードで指示を入力してください。" : "キーボードで指示を入力してください。LBでモデルを選べます。"}</p>
            <div className="empty-actions">{voiceSupported && <><kbd>RB</kbd><span>PUSH TO TALK</span></>}<kbd>LB</kbd><span>POWER RING</span></div>
          </div>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`chat-message message-${message.role}`}>
            <div className="message-meta"><span>{message.role === "user" ? "YOU" : message.role === "assistant" ? assistantLabel : "SYSTEM"}</span><time>{message.streaming ? "STREAMING" : ""}</time></div>
            <p>{message.text}<span className={message.streaming ? "stream-caret" : ""} /></p>
          </article>
        ))}
        {(voiceActive || liveTranscript) && (
          <div className={`voice-caption ${voiceActive ? "is-live" : ""}`}><span className="voice-bars"><i/><i/><i/><i/></span><p>{liveTranscript || "Listening…"}</p></div>
        )}
      </div>
      <div className={`composer ${voiceActive ? "is-listening" : ""}`}>
        <textarea
          ref={inputRef}
          value={value}
          rows={2}
          placeholder={voiceActive ? "音声を認識しています…" : `${assistantLabel}への指示を入力…`}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        {voiceSupported && (
          <button className={`voice-button ${voiceActive ? "is-active" : ""}`} onPointerDown={onVoiceStart} onPointerUp={onVoiceStop} onPointerCancel={onVoiceStop} onPointerLeave={onVoiceStop} aria-label="Push to talk"><MicIcon /></button>
        )}
        <button className={`send-button ${busy ? "is-stop" : ""}`} onClick={busy ? onInterrupt : onSend} aria-label={busy ? "Interrupt" : "Send"}>{busy ? <StopIcon /> : <span>↗</span>}</button>
      </div>
      <div className="composer-hints"><span><kbd>A</kbd> SEND / APPROVE</span><span><kbd>B</kbd> INTERRUPT</span><span><kbd>X</kbd> KEYBOARD</span></div>
    </section>
  );
}
