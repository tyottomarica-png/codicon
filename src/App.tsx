import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityRail } from "./components/ActivityRail";
import { ApprovalOverlay } from "./components/ApprovalOverlay";
import { ChatPanel } from "./components/ChatPanel";
import { GearIcon, MicIcon } from "./components/Icons";
import { PowerWheel } from "./components/PowerWheel";
import { QuestionOverlay } from "./components/QuestionOverlay";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusBar } from "./components/StatusBar";
import { PushToTalkCapture } from "./lib/audio";
import { previewBootstrap } from "./lib/mockData";
import { effortLabel } from "./lib/radial";
import { useAgentSession } from "./hooks/useAgentSession";
import { useGamepad } from "./hooks/useGamepad";
import type { BootstrapData, CodiconSettings, TargetState } from "./types/codicon";

const INITIAL_TARGET: TargetState = { target: "codex", source: "fallback", app: "", detected: null };

export default function App() {
  const [boot, setBoot] = useState<BootstrapData | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CodiconSettings | null>(null);
  const [target, setTarget] = useState<TargetState>(INITIAL_TARGET);
  const [composer, setComposer] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [previewSlot, setPreviewSlot] = useState<number | null>(null);
  const [previewEffort, setPreviewEffort] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const captureRef = useRef<PushToTalkCapture | null>(null);
  const pttRequested = useRef(false);
  const pttProviderRef = useRef<"codex" | "claude">("codex");
  const wheelOrigin = useRef({ slot: 0, effort: "medium" });
  const previewSlotRef = useRef<number | null>(null);
  const previewEffortRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const data = window.codicon ? await window.codicon.bootstrap() : previewBootstrap;
        if (disposed) return;
        setBoot(data);
        setSettings(data.settings);
      } catch (loadError) {
        if (disposed) return;
        setBoot(previewBootstrap);
        setSettings(previewBootstrap.settings);
        setBootError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    };
    void load();
    const unsubscribe = window.codicon?.onTargetChanged(setTarget);
    void window.codicon?.getTarget().then(setTarget).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const codexSession = useAgentSession("codex", boot?.providers.codex ?? null, settings);
  const claudeSession = useAgentSession("claude", boot?.providers.claude ?? null, settings);
  const sessionFor = (provider: "codex" | "claude") => (provider === "claude" ? claudeSession : codexSession);
  const session = sessionFor(target.target);
  const assistantLabel = target.target === "claude" ? "CLAUDE" : "CODEX";
  const voiceSupported = target.target === "codex";

  // Approvals must stay visible and answerable no matter which provider raised them: auto
  // targeting can flip the active session while a modal is open, and silently rerouting the A
  // press — or hiding the modal — would approve or orphan the wrong request.
  const pendingApproval = codexSession.approval
    ? { session: codexSession, request: codexSession.approval }
    : claudeSession.approval
      ? { session: claudeSession, request: claudeSession.approval }
      : null;
  const pendingQuestion = codexSession.inputRequest
    ? { session: codexSession, request: codexSession.inputRequest }
    : claudeSession.inputRequest
      ? { session: claudeSession, request: claudeSession.inputRequest }
      : null;

  // A press that was aimed at the composer must not accept an approval that appeared milliseconds
  // ago; ignore controller decisions until the dialog has been on screen long enough to be seen.
  const approvalShownAt = useRef(0);
  const approvalKey = pendingApproval?.request.id ?? pendingQuestion?.request.id ?? null;
  useEffect(() => {
    if (approvalKey !== null) approvalShownAt.current = Date.now();
  }, [approvalKey]);
  const approvalSeen = () => Date.now() - approvalShownAt.current >= 350;

  const slots = session.slots;
  const effectiveSlot = Math.min(previewSlot ?? session.selectedSlot, Math.max(0, slots.length - 1));
  const effectiveModel = slots.length
    ? session.models.find((model) => model.model === slots[effectiveSlot]?.modelId || model.id === slots[effectiveSlot]?.modelId) || session.models[0]
    : session.models[0];
  const effectiveEfforts = useMemo(() => effectiveModel?.efforts || [], [effectiveModel]);

  const send = () => {
    if (!composer.trim()) {
      inputRef.current?.focus();
      return;
    }
    void session.sendMessage(composer);
    setComposer("");
  };

  // The whole LB gesture — open, preview, commit — belongs to the session that was active when it
  // began. Auto targeting may flip the active provider mid-hold, and committing the previewed
  // indices onto the OTHER provider's ring would select an unrelated model.
  const wheelProviderRef = useRef<"codex" | "claude">("codex");
  const wheelSession = wheelOpen ? sessionFor(wheelProviderRef.current) : session;

  const openWheel = () => {
    wheelProviderRef.current = target.target;
    wheelOrigin.current = { slot: session.selectedSlot, effort: session.selectedEffort };
    previewSlotRef.current = session.selectedSlot;
    previewEffortRef.current = session.selectedEffort;
    setPreviewSlot(session.selectedSlot);
    setPreviewEffort(session.selectedEffort);
    setWheelOpen(true);
  };

  const previewWheel = (modelIndex: number | null, effortIndex: number | null) => {
    const gestureSession = sessionFor(wheelProviderRef.current);
    const gestureSlots = gestureSession.slots;
    const nextSlot = modelIndex ?? previewSlotRef.current ?? gestureSession.selectedSlot;
    previewSlotRef.current = nextSlot;
    setPreviewSlot(nextSlot);
    const model = gestureSession.models.find((entry) => entry.model === gestureSlots[nextSlot]?.modelId || entry.id === gestureSlots[nextSlot]?.modelId) || gestureSession.models[0];
    const efforts = model?.efforts || [];
    if (effortIndex !== null && efforts[effortIndex]) {
      previewEffortRef.current = efforts[effortIndex].id;
      setPreviewEffort(efforts[effortIndex].id);
    } else if (previewEffortRef.current && !efforts.some((option) => option.id === previewEffortRef.current)) {
      const fallback = model?.defaultEffort || efforts[0]?.id || "medium";
      previewEffortRef.current = fallback;
      setPreviewEffort(fallback);
    }
  };

  const commitWheel = () => {
    const slot = previewSlotRef.current ?? wheelOrigin.current.slot;
    const effort = previewEffortRef.current ?? wheelOrigin.current.effort;
    void sessionFor(wheelProviderRef.current).selectPower(slot, effort);
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
    if (!voiceSupported) {
      session.setError("音声入力は Codex ターゲットでのみ利用できます。VIEW ボタンでターゲットを切り替えてください。");
      return;
    }
    pttRequested.current = true;
    pttProviderRef.current = "codex";
    session.setLiveTranscript("");
    session.setError(null);
    if (!window.codicon) {
      session.setVoiceActive(true);
      return;
    }
    try {
      const currentThread = await session.ensureThread();
      await window.codicon.voiceStart({ provider: "codex", threadId: currentThread });
      if (!pttRequested.current) {
        await window.codicon.voiceStop({ provider: "codex", threadId: currentThread });
        return;
      }
      const capture = new PushToTalkCapture((audio) => window.codicon!.voiceAudio({ provider: "codex", threadId: currentThread, audio }));
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
    // Voice always belongs to the codex session, even if the target switched mid-hold.
    const voiceSession = pttProviderRef.current === "claude" ? claudeSession : codexSession;
    try {
      await capture?.stop();
      if (window.codicon && voiceSession.threadId) await window.codicon.voiceStop({ provider: "codex", threadId: voiceSession.threadId });
      else window.setTimeout(() => voiceSession.setVoiceActive(false), 300);
    } catch (voiceError) {
      voiceSession.setError(voiceError instanceof Error ? voiceError.message : String(voiceError));
    } finally {
      voiceSession.setVoiceActive(false);
    }
  };

  const gamepad = useGamepad(settings, slots.length || 3, effectiveEfforts.length || 5, {
    onWheelOpen: openWheel,
    onWheelPreview: previewWheel,
    onWheelCommit: commitWheel,
    onWheelCancel: cancelWheel,
    onPrimary: () => {
      if (pendingApproval) {
        if (approvalSeen()) void pendingApproval.session.respondApproval("accept");
      } else if (pendingQuestion) {
        if (approvalSeen()) pendingQuestion.session.answerUserInputDefaults();
      } else {
        send();
      }
    },
    onCancel: () => {
      if (pendingApproval) {
        if (approvalSeen()) void pendingApproval.session.respondApproval("decline");
      } else {
        void session.interrupt();
      }
    },
    onFocusComposer: () => inputRef.current?.focus(),
    onNewThread: session.newThread,
    onSettings: () => (settingsOpen ? setSettingsOpen(false) : void openSettings()),
    onPushToTalkStart: () => void startVoice(),
    onPushToTalkStop: () => void stopVoice(),
    onFastToggle: () => void session.toggleFast(),
  });

  // Mirror what the overlays show. They live in their own windows, so they cannot read this state
  // directly; the main process relays it.
  useEffect(() => {
    window.codicon?.publishHudState({
      connection: session.connection,
      target: target.target,
      targetSource: target.source,
      model: session.selectedModel?.displayName || "",
      effort: session.selectedEffort,
      serviceTier: session.selectedServiceTier,
      busy: Boolean(session.activeTurnId),
      voiceActive: voiceSupported && codexSession.voiceActive,
      approvalPending: Boolean(pendingApproval || pendingQuestion),
      controller: gamepad.snapshot.connected,
    });
  }, [
    session.connection,
    target,
    voiceSupported,
    session.selectedModel,
    session.selectedEffort,
    session.selectedServiceTier,
    session.activeTurnId,
    codexSession.voiceActive,
    pendingApproval,
    pendingQuestion,
    gamepad.snapshot.connected,
  ]);

  useEffect(() => {
    window.codicon?.publishWheelState({
      open: wheelOpen,
      target: wheelOpen ? wheelProviderRef.current : target.target,
      slots: wheelSession.slots,
      models: wheelSession.models,
      selectedSlot: wheelSession.selectedSlot,
      selectedEffort: wheelSession.selectedEffort,
      previewSlot,
      previewEffort,
      serviceTier: wheelSession.selectedServiceTier,
    });
  }, [wheelOpen, target.target, wheelSession.slots, wheelSession.models, wheelSession.selectedSlot, wheelSession.selectedEffort, previewSlot, previewEffort, wheelSession.selectedServiceTier]);

  const chooseWorkspace = useCallback(async (): Promise<string | null> => {
    if (!window.codicon || !settings) return null;
    const workspace = await window.codicon.chooseWorkspace();
    if (workspace) setSettings({ ...settings, workspace });
    return workspace;
  }, [settings]);

  const saveSettings = useCallback(async (next: Partial<CodiconSettings>) => {
    const saved = window.codicon ? await window.codicon.saveSettings(next) : { ...settings!, ...next };
    setSettings(saved);
  }, [settings]);

  // The main process is the settings authority — the tray and the HUD drag write to it directly —
  // so the panel must open on a fresh copy, not on this window's possibly stale snapshot.
  const openSettings = useCallback(async () => {
    if (window.codicon) {
      const fresh = await window.codicon.getSettings().catch(() => null);
      if (fresh) setSettings(fresh);
    }
    setSettingsOpen(true);
  }, []);

  const cycleTarget = useCallback(() => {
    void window.codicon?.cycleTarget().then(setTarget).catch(() => undefined);
  }, []);

  if (!settings || !boot) {
    return <div className="boot-screen"><div className="boot-mark">C</div><span>INITIALIZING CONTROL SURFACE</span><i /></div>;
  }

  return (
    <div className="app-shell">
      <StatusBar
        connection={session.connection}
        gamepad={gamepad.snapshot}
        controller={gamepad.status}
        target={target}
        workspace={settings.workspace}
        onWorkspace={() => void chooseWorkspace()}
        onCycleTarget={cycleTarget}
      />
      <main className="app-grid">
        <div className="control-deck">
          <div className="deck-heading"><span>POWER CONTROL</span><small>{assistantLabel} / DUAL-STICK RADIAL INPUT</small></div>
          {!session.available && session.connection !== "preview" && (
            <div className="provider-warning">
              <strong>{assistantLabel} は利用できません</strong>
              <p>{session.reason || "接続を確認してください。"}</p>
            </div>
          )}
          <PowerWheel
            slots={wheelSession.slots}
            models={wheelSession.models}
            selectedSlot={wheelSession.selectedSlot}
            selectedEffort={wheelSession.selectedEffort}
            previewSlot={previewSlot}
            previewEffort={previewEffort}
            open={wheelOpen}
            serviceTier={wheelSession.selectedServiceTier}
            onSelectSlot={(index) => void session.selectPower(index)}
            onSelectEffort={(effort) => void session.selectPower(session.selectedSlot, effort)}
          />
          <div className="power-summary">
            <div><span>MODEL</span><strong>{session.selectedModel?.displayName || slots[session.selectedSlot]?.label || "—"}</strong></div>
            <div><span>EFFORT</span><strong>{effortLabel(session.selectedEffort)}</strong></div>
            <button onClick={() => void session.toggleFast()}><span>SPEED</span><strong>{session.selectedServiceTier ? "FAST" : "STANDARD"}</strong></button>
            <div><span>MODE</span><strong>{session.selectedEffort === "ultra" ? "MULTI-AGENT" : "SINGLE AGENT"}</strong></div>
          </div>
          <div className="controller-legend">
            <div><kbd>LB</kbd><span>HOLD + LS/RS</span><strong>SELECT POWER</strong></div>
            <div><kbd>RB</kbd><span>HOLD TO SPEAK</span><strong>VOICE COMMAND</strong></div>
            <div><kbd>VIEW</kbd><span>CLICK TO SWITCH</span><strong>{target.target === "claude" ? "→ CODEX" : "→ CLAUDE"}</strong></div>
          </div>
        </div>
        <ChatPanel
          messages={session.messages}
          value={composer}
          busy={Boolean(session.activeTurnId)}
          voiceActive={voiceSupported && codexSession.voiceActive}
          voiceSupported={voiceSupported}
          assistantLabel={assistantLabel}
          liveTranscript={voiceSupported ? codexSession.liveTranscript : ""}
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
        {voiceSupported && (
          <button className={`footer-voice ${codexSession.voiceActive ? "is-active" : ""}`} onPointerDown={() => void startVoice()} onPointerUp={() => void stopVoice()} onPointerLeave={() => void stopVoice()} onPointerCancel={() => void stopVoice()}><MicIcon /><span>{codexSession.voiceActive ? "LISTENING" : "PUSH TO TALK"}</span></button>
        )}
        <button className="settings-trigger" onClick={() => void openSettings()}><GearIcon /><span>SETTINGS</span><kbd>MENU</kbd></button>
      </footer>
      {(session.error || bootError) && (
        <div className="error-toast" role="alert"><span>!</span><p>{session.error || bootError}</p><button onClick={() => { session.setError(null); setBootError(null); }}>×</button></div>
      )}
      {pendingApproval && <ApprovalOverlay request={pendingApproval.request} onDecision={(decision) => void pendingApproval.session.respondApproval(decision)} />}
      {!pendingApproval && pendingQuestion && <QuestionOverlay request={pendingQuestion.request} onSubmit={(answers) => void pendingQuestion.session.answerUserInput(answers)} />}
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        codexModels={codexSession.models}
        claudeModels={claudeSession.models}
        onClose={() => setSettingsOpen(false)}
        onChooseWorkspace={chooseWorkspace}
        onSave={saveSettings}
      />
    </div>
  );
}
