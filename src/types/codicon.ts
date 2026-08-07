export type PermissionMode = "read-only" | "auto" | "full";

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
};

export type CodiconSettings = {
  workspace: string;
  codexPath: string;
  controllerEnabled: boolean;
  hudEnabled: boolean;
  hudBounds: { x: number; y: number } | null;
  quitOnWindowClose: boolean;
  deadzone: number;
  permissionMode: PermissionMode;
  modelSlots: ModelSlot[];
  bindings: ControllerBindings;
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
  | { type: "fastToggle" };

export type ControllerStatus = {
  /** False when SDL could not start; the renderer then falls back to the focus-limited Web API. */
  available: boolean;
  reason: string;
  connected: boolean;
  id: string;
  /** True once SDL was told to keep delivering input while Codicon is in the background. */
  backgroundEvents: boolean;
};

export type HudState = {
  connection: string;
  model: string;
  effort: string;
  serviceTier: string | null;
  busy: boolean;
  voiceActive: boolean;
  approvalPending: boolean;
  controller: boolean;
};

export type ReasoningOption = {
  reasoningEffort: string;
  description: string;
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: ReasoningOption[];
  defaultReasoningEffort: string;
  serviceTiers: Array<{ id: string; name: string; description: string }>;
  defaultServiceTier: string | null;
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

export type CodexEvent = {
  kind: "notification" | "request" | "log" | "exit";
  method?: string;
  id?: number | string;
  params?: Record<string, unknown>;
  message?: string;
  details?: unknown;
};

export type BootstrapData = {
  platform: string;
  version: string;
  codexPath: string;
  settings: CodiconSettings;
  models: { data?: CodexModel[]; error?: string };
  account: Record<string, unknown> & { error?: string };
  config: Record<string, unknown> & { error?: string };
  threads: { data?: ThreadSummary[]; error?: string };
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
  startThread(options: { cwd: string; model: string; effort: string; serviceTier: string | null }): Promise<Record<string, unknown>>;
  resumeThread(threadId: string): Promise<Record<string, unknown>>;
  listThreads(): Promise<{ data?: ThreadSummary[] }>;
  sendMessage(payload: { threadId: string; activeTurnId: string | null; text: string; model: string; effort: string; serviceTier: string | null }): Promise<Record<string, unknown>>;
  updatePower(payload: { threadId: string | null; model: string; effort: string; serviceTier: string | null }): Promise<Record<string, unknown>>;
  interrupt(payload: { threadId: string; turnId: string }): Promise<Record<string, unknown>>;
  respond(payload: { id: number | string; result: unknown }): Promise<boolean>;
  voiceStart(threadId: string): Promise<Record<string, unknown>>;
  voiceAudio(payload: { threadId: string; audio: AudioChunk }): Promise<Record<string, unknown>>;
  voiceStop(threadId: string): Promise<Record<string, unknown>>;
  onEvent(listener: (event: CodexEvent) => void): () => void;
  controllerStatus(): Promise<ControllerStatus>;
  setControllerContext(context: { modelCount: number; effortCount: number }): void;
  onControllerActions(listener: (actions: ControllerAction[]) => void): () => void;
  onControllerSnapshot(listener: (snapshot: GamepadSnapshot) => void): () => void;
  onControllerStatus(listener: (status: ControllerStatus) => void): () => void;
  publishHudState(patch: Partial<HudState>): void;
  hudState(): Promise<HudState>;
  setHudEnabled(enabled: boolean): Promise<boolean>;
  onHudState(listener: (state: HudState) => void): () => void;
  showMainWindow(): void;
};

export type GamepadSnapshot = {
  connected: boolean;
  id: string;
  left: [number, number];
  right: [number, number];
};

declare global {
  interface Window {
    codicon?: CodiconApi;
    webkitAudioContext?: typeof AudioContext;
  }
}
