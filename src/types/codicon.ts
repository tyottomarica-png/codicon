export type PermissionMode = "read-only" | "auto" | "full";

/** The two agent backends Codicon can drive. */
export type AgentProvider = "codex" | "claude";

export type ModelSlot = {
  key: string;
  label: string;
  modelId: string;
  color: string;
};

export type ControllerBindings = {
  primary: number;
  cancel: number;
  focusComposer: number;
  newThread: number;
  powerWheel: number;
  pushToTalk: number;
  fastMode: number;
  settings: number;
  switchTarget: number;
  skillsRing: number;
};

/** One entry of the Skills ring: a saved prompt the controller can fire at the active chat. */
export type Skill = {
  id: string;
  label: string;
  prompt: string;
  color: string;
};

/** How a ring commit reaches the agent: not at all, via the clipboard, or by typing it. */
export type DirectControlMode = "off" | "clipboard" | "type";

export type DirectStatus = {
  mode: DirectControlMode;
  typingAvailable: boolean;
  accessibilityTrusted: boolean;
  platform: string;
  lastResult: DirectResult | null;
};

export type DirectResult = {
  sent: boolean;
  mode: string;
  preview: string;
  reason?: string;
  at?: number;
};

export type TargetSettings = {
  mode: "auto" | "manual";
  manual: AgentProvider;
};

export type CodiconSettings = {
  workspace: string;
  codexPath: string;
  claudePath: string;
  controllerEnabled: boolean;
  hudEnabled: boolean;
  hudBounds: { x: number; y: number } | null;
  quitOnWindowClose: boolean;
  deadzone: number;
  permissionMode: PermissionMode;
  target: TargetSettings;
  directControl: { mode: DirectControlMode };
  providers: Record<AgentProvider, { slots: ModelSlot[] }>;
  skills: Skill[];
  bindings: ControllerBindings;
};

export type EffortOption = {
  id: string;
  description: string;
};

/** Provider-neutral model shape produced by the adapters in the main process. */
export type AgentModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  efforts: EffortOption[];
  defaultEffort: string | null;
  tiers: Array<{ id: string; name: string }>;
  defaultTier: string | null;
  isDefault: boolean;
};

export type ThreadSummary = {
  id: string;
  preview: string;
  name: string | null;
  cwd: string;
  updatedAt: number;
  recencyAt: number | null;
  status: { type: string; activeFlags?: string[] };
};

/** Provider-neutral events emitted by the agent adapters. */
export type AgentEvent = { provider: AgentProvider; threadId?: string } & (
  | { kind: "status"; state: "starting" | "ready" | "exit"; detail?: string }
  | { kind: "turn-started"; turnId: string }
  | { kind: "turn-completed" }
  | { kind: "message-delta"; itemId: string; delta: string }
  | { kind: "message-completed"; itemId: string; text: string }
  | { kind: "activity"; id: string; type: string; title: string; detail: string; status: "running" | "completed" | "failed" }
  | { kind: "activity-status"; id: string; status: "running" | "completed" | "failed" }
  | { kind: "approval"; id: number | string; title: string; command: string; reason: string }
  | { kind: "approval-dismissed"; id: number | string }
  | { kind: "question"; id: number | string; questions: InputQuestion[] }
  | { kind: "voice-started" }
  | { kind: "voice-transcript-delta"; delta: string }
  | { kind: "voice-transcript-done"; text: string }
  | { kind: "voice-closed" }
  | { kind: "voice-error"; message: string }
  | { kind: "error"; message: string }
  | { kind: "log"; message: string }
);

export type InputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};

export type ProviderBootstrap = {
  available: boolean;
  reason?: string;
  models: AgentModel[];
  threads: ThreadSummary[];
  accountLabel: string;
};

export type BootstrapData = {
  platform: string;
  version: string;
  codexPath: string;
  settings: CodiconSettings;
  providers: Record<AgentProvider, ProviderBootstrap>;
};

/** How the active target was decided, as reported by the main-process focus tracker. */
export type TargetState = {
  target: AgentProvider;
  source: "manual" | "auto" | "sticky" | "fallback";
  app: string;
  detected: AgentProvider | null;
};

/** Semantic controller events produced by the main-process reader. */
export type ControllerAction =
  | { type: "wheel/open" }
  | { type: "wheel/preview"; modelIndex: number | null; effortIndex: number | null }
  | { type: "wheel/commit" }
  | { type: "wheel/cancel" }
  | { type: "primary" }
  | { type: "cancel" }
  | { type: "focusComposer" }
  | { type: "newThread" }
  | { type: "settings" }
  | { type: "pushToTalk/start" }
  | { type: "pushToTalk/stop" }
  | { type: "fastToggle" }
  | { type: "switchTarget" }
  | { type: "skills/open" }
  | { type: "skills/preview"; skillIndex: number | null }
  | { type: "skills/commit" }
  | { type: "skills/cancel" };

export type ControllerStatus = {
  /** False when SDL could not start; the renderer then has no controller input at all. */
  available: boolean;
  reason: string;
  connected: boolean;
  id: string;
  /** True once SDL was told to keep delivering input while Codicon is in the background. */
  backgroundEvents: boolean;
};

export type GamepadSnapshot = {
  connected: boolean;
  id: string;
  left: [number, number];
  right: [number, number];
};

export type HudState = {
  connection: string;
  target: AgentProvider;
  targetSource: TargetState["source"];
  model: string;
  effort: string;
  serviceTier: string | null;
  busy: boolean;
  voiceActive: boolean;
  approvalPending: boolean;
  controller: boolean;
  /** Live chat counts, mirroring the Agent Keys lamps. */
  agentsRunning: number;
  agentsWaiting: number;
  agentsTotal: number;
};

/** State the main window publishes for the standalone wheel overlay window. */
export type WheelOverlayState = {
  open: boolean;
  mode: "power" | "skills";
  target: AgentProvider;
  slots: ModelSlot[];
  models: AgentModel[];
  selectedSlot: number;
  selectedEffort: string;
  previewSlot: number | null;
  previewEffort: string | null;
  serviceTier: string | null;
  skills: Skill[];
  previewSkill: number | null;
};

export type AudioChunk = {
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
  itemId: null;
};

export type CodiconApi = {
  bootstrap(): Promise<BootstrapData>;
  chooseWorkspace(): Promise<string | null>;
  getSettings(): Promise<CodiconSettings>;
  saveSettings(settings: Partial<CodiconSettings>): Promise<CodiconSettings>;
  restartServer(): Promise<boolean>;

  startThread(payload: { provider: AgentProvider; model: string; effort: string; tier: string | null }): Promise<{ threadId: string }>;
  sendMessage(payload: { provider: AgentProvider; threadId: string; activeTurnId: string | null; text: string; model: string; effort: string; tier: string | null }): Promise<{ turnId: string | null }>;
  updatePower(payload: { provider: AgentProvider; threadId: string | null; model: string; effort: string; tier: string | null }): Promise<unknown>;
  interrupt(payload: { provider: AgentProvider; threadId: string; turnId: string }): Promise<unknown>;
  respond(payload: { provider: AgentProvider; id: number | string; decision?: string; answers?: Record<string, string> }): Promise<boolean>;
  resumeThread(payload: { provider: AgentProvider; threadId: string }): Promise<{ threadId: string; messages: Array<{ id: string; role: "user" | "assistant"; text: string }> }>;
  closeThread(payload: { provider: AgentProvider; threadId: string }): Promise<boolean>;
  listThreads(provider: AgentProvider): Promise<{ data: ThreadSummary[] }>;
  voiceStart(payload: { provider: AgentProvider; threadId: string }): Promise<unknown>;
  voiceAudio(payload: { provider: AgentProvider; threadId: string; audio: AudioChunk }): Promise<unknown>;
  voiceStop(payload: { provider: AgentProvider; threadId: string }): Promise<unknown>;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;

  getTarget(): Promise<TargetState>;
  setTarget(target: TargetSettings): Promise<TargetState>;
  cycleTarget(): Promise<TargetState>;
  onTargetChanged(listener: (state: TargetState) => void): () => void;

  directStatus(): Promise<DirectStatus>;
  requestAccessibility(): Promise<DirectStatus>;
  directDispatch(payload: { provider: AgentProvider; action: string; value?: string | null }): Promise<DirectResult>;
  onDirectResult(listener: (result: DirectResult) => void): () => void;
  controllerStatus(): Promise<ControllerStatus>;
  setControllerContext(context: { modelCount: number; effortCount: number; skillCount: number }): void;
  onControllerActions(listener: (actions: ControllerAction[]) => void): () => void;
  onControllerSnapshot(listener: (snapshot: GamepadSnapshot) => void): () => void;
  onControllerStatus(listener: (status: ControllerStatus) => void): () => void;

  publishHudState(patch: Partial<HudState>): void;
  hudState(): Promise<HudState>;
  setHudEnabled(enabled: boolean): Promise<boolean>;
  onHudState(listener: (state: HudState) => void): () => void;
  publishWheelState(state: WheelOverlayState): void;
  onWheelState(listener: (state: WheelOverlayState) => void): () => void;
  showMainWindow(): void;
};

declare global {
  interface Window {
    codicon?: CodiconApi;
    webkitAudioContext?: typeof AudioContext;
  }
}
