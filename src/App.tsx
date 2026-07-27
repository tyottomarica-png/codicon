import { useMemo, useRef, useState } from "react";
import { ActivityRail } from "./components/ActivityRail";
import { ApprovalOverlay } from "./components/ApprovalOverlay";
import { ChatPanel } from "./components/ChatPanel";
import { GearIcon, MicIcon } from "./components/Icons";
import { PowerWheel } from "./components/PowerWheel";
import { QuestionOverlay } from "./components/QuestionOverlay";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusBar } from "./components/StatusBar";
import { PushToTalkCapture } from "./lib/audio";
import { effortLabel } from "./lib/radial";
import { useCodexSession } from "./hooks/useCodexSession";
import { useGamepad } from "./hooks/useGamepad";
import type { CodexModel } from "./types/codicon";

function modelAtSlot(models: CodexModel[], modelId: string): CodexModel | undefined {
  return models.find((model) => model.model === modelId || model.id === modelId);
}

export default function App() {
  const session = useCodexSession();
  const [composer, setComposer] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [previewSlot, setPreviewSlot] = useState<number | null>(null);
  const [previewEffort, setPreviewEffort] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const captureRef = useRef<PushToTalkCapture | null>(null);
  const pttRequested = useRef(false);
  const wheelOrigin = useRef({ slot: 0, effort: "medium" });
  const previewSlotRef = useRef<number | null>(null);
  const previewEffortRef = useRef<string | null>(null);

  const slots = session.settings?.modelSlots || [];
  const effectiveSlot = previewSlot ?? session.selectedSlot;
  const effectiveModel = slots.length ? modelAtSlot(session.models, slots[effectiveSlot]?.modelId) || session.models[0] : session.models[0];
  const effectiveEfforts = useMemo(() => effectiveModel?.supportedReasoningEfforts || [], [effectiveModel]);

  const send = () => {
    if (!composer.trim()) {
      inputRef.current?.focus();
      return;
    }
    void session.sendMessage(composer);
    setComposer("");
  };

  const openWheel = () => {
    wheelOrigin.current = { slot: session.selectedSlot, effort: session.selectedEffort };
    previewSlotRef.current = session.selectedSlot;
    previewEffortRef.current = session.selectedEffort;
    setPreviewSlot(session.selectedSlot);
    setPreviewEffort(session.selectedEffort);
    setWheelOpen(true);
  };

  const previewWheel = (modelIndex: number | null, effortIndex: number | null) => {
    const nextSlot = modelIndex ?? previewSlotRef.current ?? session.selectedSlot;
    previewSlotRef.current = nextSlot;
    setPreviewSlot(nextSlot);
    const model = modelAtSlot(session.models, slots[nextSlot]?.modelId) || session.models[0];
    const efforts = model?.supportedReasoningEfforts || [];
    if (effortIndex !== null && efforts[effortIndex]) {
      previewEffortRef.current = efforts[effortIndex].reasoningEffort;
      setPreviewEffort(efforts[effortIndex].reasoningEffort);
    } else if (previewEffortRef.current && !efforts.some((option) => option.reasoningEffort === previewEffortRef.current)) {
      const fallback = model?.defaultReasoningEffort || efforts[0]?.reasoningEffort || "medium";
      previewEffortRef.current = fallback;
      setPreviewEffort(fallback);
    }
  };

  const commitWheel = () => {
    const slot = previewSlotRef.current ?? wheelOrigin.current.slot;
    const effort = previewEffortRef.current ?? wheelOrigin.current.effort;
    void session.selectPower(slot, effort);
    setWheelOpen(false);
    setPreviewSlot(null);
    setPreviewEffort(null);
  };

  const cancelWheel = () => {
    previewSlotRef.current = null;
    previewEffortRef.current = null;
    setWheelOpen(false);
    setPreviewSlot(null);
    setPreviewEffort(null);
  };

  const startVoice = async () => {
    if (pttRequested.current || captureRef.current) return;
    pttRequested.current = true;
    session.setLiveTranscript("");
    session.setError(null);
    if (!window.codicon) {
      session.setVoiceActive(true);
      return;
    }
    try {
      const currentThread = await session.ensureThread();
      await window.codicon.voiceStart(currentThread);
      if (!pttRequested.current) {
        await window.codicon.voiceStop(currentThread);
        return;
      }
      const capture = new PushToTalkCapture((audio) => window.codicon!.voiceAudio({ threadId: currentThread, audio }));
      captureRef.current = capture;
      await capture.start();
      session.setVoiceActive(true);
    } catch (voiceError) {
      pttRequested.current = false;
      captureRef.current = null;
      session.setVoiceActive(false);
      session.setError(voiceError instanceof Error ? voiceError.message : String(voiceError));
    }
  };

  const stopVoice = async () => {
    if (!pttRequested.current && !captureRef.current) return;
    pttRequested.current = false;
    const capture = captureRef.current;
    captureRef.current = null;
    try {
      await capture?.stop();
      if (window.codicon && session.threadId) await window.codicon.voiceStop(session.threadId);
      else window.setTimeout(() => session.setVoiceActive(false), 300);
    } catch (voiceError) {
      session.setError(voiceError instanceof Error ? voiceError.message : String(voiceError));
    } finally {
      session.setVoiceActive(false);
    }
  };

  const gamepad = useGamepad(session.settings, slots.length || 3, effectiveEfforts.length || 5, {
    onWheelOpen: openWheel,
    onWheelPreview: previewWheel,
    onWheelCommit: commitWheel,
    onWheelCancel: cancelWheel,
    onPrimary: () => session.approval ? void session.respondApproval("accept") : session.inputRequest ? session.answerUserInputDefaults() : send(),
    onCancel: () => session.approval ? void session.respondApproval("decline") : void session.interrupt(),
    onFocusComposer: () => inputRef.current?.focus(),
    onNewThread: session.newThread,
    onSettings: () => setSettingsOpen((open) => !open),
    onPushToTalkStart: () => void startVoice(),
    onPushToTalkStop: () => void stopVoice(),
    onFastToggle: () => void session.toggleFast(),
  });

  if (!session.settings || !slots.length || !session.models.length) {
    return <div className="boot-screen"><div className="boot-mark">C</div><span>INITIALIZING CONTROL SURFACE</span><i /></div>;
  }

  return (
    <div className="app-shell">
      <StatusBar connection={session.connection} gamepad={gamepad} workspace={session.settings.workspace} onWorkspace={() => void session.chooseWorkspace()} />
      <main className="app-grid">
        <div className="control-deck">
          <div className="deck-heading"><span>POWER CONTROL</span><small>DUAL-STICK RADIAL INPUT</small></div>
          <PowerWheel
            slots={slots}
            models={session.models}
            selectedSlot={session.selectedSlot}
            selectedEffort={session.selectedEffort}
            previewSlot={previewSlot}
            previewEffort={previewEffort}
            open={wheelOpen}
            serviceTier={session.selectedServiceTier}
            onSelectSlot={(index) => void session.selectPower(index)}
            onSelectEffort={(effort) => void session.selectPower(session.selectedSlot, effort)}
          />
          <div className="power-summary">
            <div><span>MODEL</span><strong>{session.selectedModel?.displayName || slots[session.selectedSlot].label}</strong></div>
            <div><span>EFFORT</span><strong>{effortLabel(session.selectedEffort)}</strong></div>
            <button onClick={() => void session.toggleFast()}><span>SPEED</span><strong>{session.selectedServiceTier ? "FAST" : "STANDARD"}</strong></button>
            <div><span>MODE</span><strong>{session.selectedEffort === "ultra" ? "MULTI-AGENT" : "SINGLE AGENT"}</strong></div>
          </div>
          <div className="controller-legend">
            <div><kbd>LB</kbd><span>HOLD + LS/RS</span><strong>SELECT POWER</strong></div>
            <div><kbd>RB</kbd><span>HOLD TO SPEAK</span><strong>VOICE COMMAND</strong></div>
            <div><kbd>RS</kbd><span>CLICK TO TOGGLE</span><strong>FAST MODE</strong></div>
          </div>
        </div>
        <ChatPanel
          messages={session.messages}
          value={composer}
          busy={Boolean(session.activeTurnId)}
          voiceActive={session.voiceActive}
          liveTranscript={session.liveTranscript}
          inputRef={inputRef}
          onChange={setComposer}
          onSend={send}
          onInterrupt={() => void session.interrupt()}
          onVoiceStart={() => void startVoice()}
          onVoiceStop={() => void stopVoice()}
        />
        <ActivityRail activity={session.activity} threads={session.threads} accountLabel={session.accountLabel} onResume={(thread) => void session.resumeThread(thread)} />
      </main>
      <footer className="global-footer">
        <div><span className="footer-index">SYS</span><span>{session.threadId ? `THREAD ${session.threadId.slice(0, 8)}` : "NEW SESSION"}</span></div>
        <button className={`footer-voice ${session.voiceActive ? "is-active" : ""}`} onPointerDown={() => void startVoice()} onPointerUp={() => void stopVoice()}><MicIcon /><span>{session.voiceActive ? "LISTENING" : "PUSH TO TALK"}</span></button>
        <button className="settings-trigger" onClick={() => setSettingsOpen(true)}><GearIcon /><span>SETTINGS</span><kbd>MENU</kbd></button>
      </footer>
      {session.error && <div className="error-toast" role="alert"><span>!</span><p>{session.error}</p><button onClick={() => session.setError(null)}>×</button></div>}
      {session.approval && <ApprovalOverlay request={session.approval} onDecision={(decision) => void session.respondApproval(decision)} />}
      {session.inputRequest && <QuestionOverlay request={session.inputRequest} onSubmit={(answers) => void session.answerUserInput(answers)} />}
      <SettingsPanel open={settingsOpen} settings={session.settings} models={session.models} onClose={() => setSettingsOpen(false)} onChooseWorkspace={() => void session.chooseWorkspace()} onSave={session.saveSettings} />
    </div>
  );
}
