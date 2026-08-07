import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityRail } from "./components/ActivityRail";
import { AgentKeys } from "./components/AgentKeys";
import { ApprovalOverlay } from "./components/ApprovalOverlay";
import { AgentReadout } from "./components/AgentReadout";
import { GearIcon, MicIcon } from "./components/Icons";
import { PowerWheel } from "./components/PowerWheel";
import { QuestionOverlay } from "./components/QuestionOverlay";
import { SettingsPanel } from "./components/SettingsPanel";
import { SkillsRing } from "./components/SkillsRing";
import { StatusBar } from "./components/StatusBar";
import { PushToTalkCapture } from "./lib/audio";
import { previewBootstrap } from "./lib/mockData";
import { effortLabel } from "./lib/radial";
import { chatStatus, useChats } from "./hooks/useChats";
import { useGamepad } from "./hooks/useGamepad";
import type { AgentProvider, BootstrapData, CodiconSettings, DirectResult, DirectStatus, TargetState } from "./types/codicon";

const INITIAL_TARGET: TargetState = { target: "codex", source: "fallback", app: "", detected: null };

export default function App() {
  const [boot, setBoot] = useState<BootstrapData | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CodiconSettings | null>(null);
  const [target, setTarget] = useState<TargetState>(INITIAL_TARGET);
  const [direct, setDirect] = useState<DirectStatus | null>(null);
  const [directResult, setDirectResult] = useState<DirectResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [previewSlot, setPreviewSlot] = useState<number | null>(null);
  const [previewEffort, setPreviewEffort] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<number | null>(null);
  const captureRef = useRef<PushToTalkCapture | null>(null);
  const pttRequested = useRef(false);
  const wheelOrigin = useRef({ slot: 0, effort: "medium" });
  const previewSlotRef = useRef<number | null>(null);
  const previewEffortRef = useRef<string | null>(null);
  const previewSkillRef = useRef<number | null>(null);

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
    const unsubscribeDirect = window.codicon?.onDirectResult((result) => {
      setDirectResult(result);
      void window.codicon?.directStatus().then(setDirect).catch(() => undefined);
    });
    void window.codicon?.getTarget().then(setTarget).catch(() => undefined);
    void window.codicon?.directStatus().then(setDirect).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
      unsubscribeDirect?.();
    };
  }, []);

  const bootstraps = useMemo(
    () => ({ codex: boot?.providers.codex ?? null, claude: boot?.providers.claude ?? null }),
    [boot],
  );
  const chats = useChats(bootstraps, settings);
  const chat = chats.activeChat;
  const skills = settings?.skills || [];

  // The Agent Key you are on decides which backend the controller speaks to; auto focus tracking
  // moves that selection rather than maintaining a second notion of "target".
  const focusProvider = chats.focusProvider;
  useEffect(() => {
    if (target.source === "auto" || target.source === "manual") focusProvider(target.target);
  }, [target.target, target.source, focusProvider]);

  const provider: AgentProvider = chat?.provider ?? target.target;
  const models = chats.modelsFor(provider);
  const slots = chats.slotsFor(provider);
  const assistantLabel = provider === "claude" ? "CLAUDE" : "CODEX";
  const voiceSupported = provider === "codex";
  const bootstrap = bootstraps[provider];

  const activeModel = useMemo(() => {
    const slot = slots[chat?.slot ?? 0];
    return models.find((entry) => entry.model === slot?.modelId || entry.id === slot?.modelId) || models[0];
  }, [models, slots, chat?.slot]);

  const effectiveModel = useMemo(() => {
    const slot = slots[previewSlot ?? chat?.slot ?? 0];
    return models.find((entry) => entry.model === slot?.modelId || entry.id === slot?.modelId) || activeModel;
  }, [models, slots, previewSlot, chat?.slot, activeModel]);

  const connection = !boot
    ? "connecting" as const
    : !window.codicon
      ? "preview" as const
      : bootstrap?.available
        ? "ready" as const
        : "unavailable" as const;

  // Any chat blocked on the user owns the modal, whichever agent raised it.
  const blocked = useMemo(() => chats.chats.find((entry) => entry.approval || entry.inputRequest) || null, [chats.chats]);
  const approvalShownAt = useRef(0);
  const blockedKey = blocked?.approval?.id ?? blocked?.inputRequest?.id ?? null;
  useEffect(() => {
    if (blockedKey !== null) approvalShownAt.current = Date.now();
  }, [blockedKey]);
  // A press must not accept a dialog that only just appeared and cannot have been read.
  const blockedSeen = () => Date.now() - approvalShownAt.current >= 350;

  const openWheel = () => {
    if (!chat) return;
    wheelOrigin.current = { slot: chat.slot, effort: chat.effort };
    previewSlotRef.current = chat.slot;
    previewEffortRef.current = chat.effort;
    setPreviewSlot(chat.slot);
    setPreviewEffort(chat.effort);
    setWheelOpen(true);
  };

  const previewWheel = (modelIndex: number | null, effortIndex: number | null) => {
    const nextSlot = modelIndex ?? previewSlotRef.current ?? chat?.slot ?? 0;
    previewSlotRef.current = nextSlot;
    setPreviewSlot(nextSlot);
    const slot = slots[nextSlot];
    const model = models.find((entry) => entry.model === slot?.modelId || entry.id === slot?.modelId) || models[0];
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

  // With direct control on, a ring commit is aimed at the agent already open in another app;
  // the local session only takes it when direct control is off or the front app is not that agent.
  const directOn = Boolean(direct && direct.mode !== "off");

  const commitWheel = () => {
    const slot = previewSlotRef.current ?? wheelOrigin.current.slot;
    const effort = previewEffortRef.current ?? wheelOrigin.current.effort;
    setWheelOpen(false);
    setPreviewSlot(null);
    setPreviewEffort(null);
    if (directOn) {
      const chosen = slots[slot];
      const model = models.find((entry) => entry.model === chosen?.modelId || entry.id === chosen?.modelId);
      if (model) void window.codicon?.directDispatch({ provider, action: "model", value: model.model });
      if (effort) void window.codicon?.directDispatch({ provider, action: "effort", value: effort });
      return;
    }
    if (chat) void chats.selectPower(chat.id, slot, effort);
  };

  const cancelWheel = () => {
    previewSlotRef.current = null;
    previewEffortRef.current = null;
    setWheelOpen(false);
    setPreviewSlot(null);
    setPreviewEffort(null);
  };

  const launchSkill = useCallback((index: number) => {
    const skill = skills[index];
    if (!skill) return;
    if (directOn) {
      void window.codicon?.directDispatch({ provider, action: "prompt", value: skill.prompt });
      return;
    }
    if (chat) void chats.sendMessage(chat.id, skill.prompt);
  }, [skills, chat, chats, directOn, provider]);

  const commitSkill = () => {
    const index = previewSkillRef.current;
    setSkillsOpen(false);
    setPreviewSkill(null);
    previewSkillRef.current = null;
    // Releasing the trigger without pushing the stick is a deliberate no-op, not skill 0.
    if (index !== null) launchSkill(index);
  };

  const startVoice = async () => {
    if (pttRequested.current || captureRef.current) return;
    if (!voiceSupported || !chat) {
      if (chat) chats.clearError(chat.id);
      return;
    }
    pttRequested.current = true;
    chats.clearError(chat.id);
    if (!window.codicon) return;
    try {
      const threadId = chat.threadId || (await window.codicon.startThread({
        provider: "codex",
        model: activeModel?.model || "",
        effort: chat.effort,
        tier: chat.tier,
      })).threadId;
      await window.codicon.voiceStart({ provider: "codex", threadId });
      if (!pttRequested.current) {
        await window.codicon.voiceStop({ provider: "codex", threadId });
        return;
      }
      const capture = new PushToTalkCapture((audio) => window.codicon!.voiceAudio({ provider: "codex", threadId, audio }));
      captureRef.current = capture;
      await capture.start();
    } catch {
      pttRequested.current = false;
      captureRef.current = null;
    }
  };

  const stopVoice = async () => {
    if (!pttRequested.current && !captureRef.current) return;
    pttRequested.current = false;
    const capture = captureRef.current;
    captureRef.current = null;
    try {
      await capture?.stop();
      if (window.codicon && chat?.threadId) await window.codicon.voiceStop({ provider: "codex", threadId: chat.threadId });
    } catch {
      // The session may already have closed the realtime channel.
    }
  };

  const openSettings = useCallback(async () => {
    if (window.codicon) {
      const fresh = await window.codicon.getSettings().catch(() => null);
      if (fresh) setSettings(fresh);
    }
    setSettingsOpen(true);
  }, []);

  const gamepad = useGamepad(settings, slots.length || 3, effectiveModel?.efforts.length || 5, skills.length || 1, {
    onWheelOpen: openWheel,
    onWheelPreview: previewWheel,
    onWheelCommit: commitWheel,
    onWheelCancel: cancelWheel,
    onSkillsOpen: () => setSkillsOpen(true),
    onSkillsPreview: (index) => {
      previewSkillRef.current = index;
      setPreviewSkill(index);
    },
    onSkillsCommit: commitSkill,
    onSkillsCancel: () => {
      setSkillsOpen(false);
      setPreviewSkill(null);
      previewSkillRef.current = null;
    },
    onPrimary: () => {
      if (blocked) {
        if (!blockedSeen()) return;
        if (blocked.approval) void chats.respondApproval(blocked.id, "accept");
        else if (blocked.inputRequest) {
          const answers = Object.fromEntries(blocked.inputRequest.questions.map((q) => [q.id, q.options?.[0]?.label || ""]));
          void chats.answerUserInput(blocked.id, answers);
        }
      }
      // With no composer, A is purely an approve key — there is nothing to send.
    },
    onCancel: () => {
      if (blocked?.approval) {
        if (blockedSeen()) void chats.respondApproval(blocked.id, "decline");
      } else if (directOn) {
        void window.codicon?.directDispatch({ provider, action: "interrupt" });
      } else if (chat) {
        void chats.interrupt(chat.id);
      }
    },
    onFocusComposer: () => window.codicon?.showMainWindow(),
    onNewThread: () => (directOn ? void window.codicon?.directDispatch({ provider, action: "newChat" }) : chats.newChat(provider)),
    onSettings: () => (settingsOpen ? setSettingsOpen(false) : void openSettings()),
    onPushToTalkStart: () => void startVoice(),
    onPushToTalkStop: () => void stopVoice(),
    onFastToggle: () => {
      if (directOn) {
        void window.codicon?.directDispatch({ provider, action: "fast", value: chat?.tier ? "off" : "on" });
        return;
      }
      if (chat) void chats.toggleFast(chat.id);
    },
  });

  const counts = useMemo(() => {
    const statuses = chats.chats.map(chatStatus);
    return {
      agentsTotal: statuses.length,
      agentsRunning: statuses.filter((status) => status === "running" || status === "thinking").length,
      agentsWaiting: statuses.filter((status) => status === "waiting").length,
    };
  }, [chats.chats]);

  useEffect(() => {
    window.codicon?.publishHudState({
      connection,
      target: provider,
      targetSource: target.source,
      model: activeModel?.displayName || "",
      effort: chat?.effort || "",
      serviceTier: chat?.tier || null,
      busy: Boolean(chat?.activeTurnId),
      voiceActive: false,
      approvalPending: Boolean(blocked),
      controller: gamepad.snapshot.connected,
      ...counts,
    });
  }, [connection, provider, target.source, activeModel, chat?.effort, chat?.tier, chat?.activeTurnId, blocked, gamepad.snapshot.connected, counts]);

  useEffect(() => {
    window.codicon?.publishWheelState({
      open: wheelOpen || skillsOpen,
      mode: skillsOpen ? "skills" : "power",
      target: provider,
      slots,
      models,
      selectedSlot: chat?.slot ?? 0,
      selectedEffort: chat?.effort || "medium",
      previewSlot,
      previewEffort,
      serviceTier: chat?.tier || null,
      skills,
      previewSkill,
    });
  }, [wheelOpen, skillsOpen, provider, slots, models, chat?.slot, chat?.effort, chat?.tier, previewSlot, previewEffort, skills, previewSkill]);

  const chooseWorkspace = useCallback(async (): Promise<string | null> => {
    if (!window.codicon || !settings) return null;
    const workspace = await window.codicon.chooseWorkspace();
    if (workspace) setSettings({ ...settings, workspace });
    return workspace;
  }, [settings]);

  const saveSettings = useCallback(async (next: Partial<CodiconSettings>) => {
    const saved = window.codicon ? await window.codicon.saveSettings(next) : { ...settings!, ...next };
    setSettings(saved);
    void window.codicon?.directStatus().then(setDirect).catch(() => undefined);
  }, [settings]);

  if (!settings || !boot) {
    return <div className="boot-screen"><div className="boot-mark">C</div><span>INITIALIZING CONTROL SURFACE</span><i /></div>;
  }

  return (
    <div className="app-shell">
      <StatusBar
        connection={connection}
        gamepad={gamepad.snapshot}
        controller={gamepad.status}
        target={target}
        workspace={settings.workspace}
        onWorkspace={() => void chooseWorkspace()}
        onCycleTarget={() => void window.codicon?.cycleTarget().then(setTarget).catch(() => undefined)}
      />
      <main className="app-grid app-grid-surface">
        <div className="control-deck">
          <div className="deck-heading"><span>{skillsOpen ? "SKILLS" : "POWER CONTROL"}</span><small>{assistantLabel} / {skillsOpen ? "LT + LS" : "DUAL-STICK RADIAL"}</small></div>
          {!bootstrap?.available && connection !== "preview" && (
            <div className="provider-warning">
              <strong>{assistantLabel} は利用できません</strong>
              <p>{bootstrap?.reason || "接続を確認してください。"}</p>
            </div>
          )}
          {skillsOpen ? (
            <SkillsRing skills={skills} previewSkill={previewSkill} open={skillsOpen} onLaunch={launchSkill} />
          ) : (
            <PowerWheel
              slots={slots}
              models={models}
              selectedSlot={chat?.slot ?? 0}
              selectedEffort={chat?.effort || "medium"}
              previewSlot={previewSlot}
              previewEffort={previewEffort}
              open={wheelOpen}
              serviceTier={chat?.tier || null}
              onSelectSlot={(index) => { if (chat) void chats.selectPower(chat.id, index); }}
              onSelectEffort={(effort) => { if (chat) void chats.selectPower(chat.id, chat.slot, effort); }}
            />
          )}
          <div className="power-summary">
            <div><span>MODEL</span><strong>{activeModel?.displayName || slots[chat?.slot ?? 0]?.label || "—"}</strong></div>
            <div><span>EFFORT</span><strong>{effortLabel(chat?.effort || "medium")}</strong></div>
            <button onClick={() => { if (chat) void chats.toggleFast(chat.id); }}><span>SPEED</span><strong>{chat?.tier ? "FAST" : "STANDARD"}</strong></button>
            <div><span>AGENTS</span><strong>{counts.agentsRunning} / {counts.agentsTotal}</strong></div>
          </div>
          <div className="controller-legend">
            <div><kbd>LB</kbd><span>HOLD + LS/RS</span><strong>SELECT POWER</strong></div>
            <div><kbd>LT</kbd><span>HOLD + LS</span><strong>RUN SKILL</strong></div>
            <div><kbd>A</kbd><span>APPROVE</span><strong>B TO DECLINE</strong></div>
          </div>
          {directOn && (
            <div className={`direct-banner ${directResult && !directResult.sent ? "is-blocked" : ""}`}>
              <span className="direct-mode">{direct?.mode === "type" ? "DIRECT · TYPE" : "DIRECT · CLIPBOARD"}</span>
              <span className="direct-detail">
                {directResult
                  ? `${directResult.preview || "—"}${directResult.sent ? "" : ` — ${directResult.reason || ""}`}`
                  : `${target.detected ? `${target.detected.toUpperCase()} が前面` : "対象アプリを前面にしてください"}`}
              </span>
            </div>
          )}
        </div>
        <AgentKeys
          chats={chats.chats}
          activeChatId={chats.activeChatId}
          canOpen={{ codex: Boolean(bootstraps.codex?.available), claude: Boolean(bootstraps.claude?.available) }}
          onSelect={chats.selectChat}
          onClose={chats.closeChat}
          onNew={chats.newChat}
        />
        <AgentReadout chat={chat} assistantLabel={assistantLabel} />
      </main>
      <footer className="global-footer">
        <div><span className="footer-index">SYS</span><span>{bootstrap?.accountLabel || "—"}</span></div>
        {voiceSupported && (
          <button className="footer-voice" onPointerDown={() => void startVoice()} onPointerUp={() => void stopVoice()} onPointerLeave={() => void stopVoice()} onPointerCancel={() => void stopVoice()}><MicIcon /><span>PUSH TO TALK</span></button>
        )}
        <button className="settings-trigger" onClick={() => void openSettings()}><GearIcon /><span>SETTINGS</span><kbd>MENU</kbd></button>
      </footer>
      {(chat?.error || bootError) && (
        <div className="error-toast" role="alert"><span>!</span><p>{chat?.error || bootError}</p><button onClick={() => { if (chat) chats.clearError(chat.id); setBootError(null); }}>×</button></div>
      )}
      {blocked?.approval && <ApprovalOverlay request={blocked.approval} onDecision={(decision) => void chats.respondApproval(blocked.id, decision)} />}
      {blocked && !blocked.approval && blocked.inputRequest && (
        <QuestionOverlay request={blocked.inputRequest} onSubmit={(answers) => void chats.answerUserInput(blocked.id, answers)} />
      )}
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        codexModels={chats.modelsFor("codex")}
        claudeModels={chats.modelsFor("claude")}
        onClose={() => setSettingsOpen(false)}
        onChooseWorkspace={chooseWorkspace}
        onSave={saveSettings}
        direct={direct}
        onRequestAccessibility={() => void window.codicon?.requestAccessibility().then(setDirect).catch(() => undefined)}
      />
    </div>
  );
}
