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
  deadzone: number;
  permissionMode: PermissionMode;
  modelSlots: ModelSlot[];
  bindings: ControllerBindings;
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
};

declare global {
  interface Window {
    codicon?: CodiconApi;
    webkitAudioContext?: typeof AudioContext;
  }
}
