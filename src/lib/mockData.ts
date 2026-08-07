import type { AgentModel, BootstrapData, CodiconSettings } from "../types/codicon";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function efforts(ids: string[]) {
  return ids.map((id) => ({ id, description: id }));
}

export const fallbackCodexModels: AgentModel[] = [
  {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "Sol",
    description: "Complex, open-ended work with detail and polish",
    efforts: efforts([...EFFORTS, "ultra"]),
    defaultEffort: "medium",
    tiers: [{ id: "priority", name: "Fast" }],
    defaultTier: null,
    isDefault: true,
  },
  {
    id: "gpt-5.6-terra",
    model: "gpt-5.6-terra",
    displayName: "Terra",
    description: "Pragmatic everyday workhorse",
    efforts: efforts([...EFFORTS, "ultra"]),
    defaultEffort: "medium",
    tiers: [{ id: "priority", name: "Fast" }],
    defaultTier: null,
    isDefault: false,
  },
  {
    id: "gpt-5.6-luna",
    model: "gpt-5.6-luna",
    displayName: "Luna",
    description: "Clear, repeatable and high-volume tasks",
    efforts: efforts(EFFORTS),
    defaultEffort: "medium",
    tiers: [{ id: "priority", name: "Fast" }],
    defaultTier: null,
    isDefault: false,
  },
];

export const fallbackClaudeModels: AgentModel[] = [
  {
    id: "claude-fable-5",
    model: "claude-fable-5",
    displayName: "Fable",
    description: "Most capable Claude model",
    efforts: efforts(EFFORTS),
    defaultEffort: "high",
    tiers: [],
    defaultTier: null,
    isDefault: true,
  },
  {
    id: "opus",
    model: "opus",
    displayName: "Opus",
    description: "Deep reasoning workhorse",
    efforts: efforts(EFFORTS),
    defaultEffort: "high",
    tiers: [{ id: "fast", name: "Fast" }],
    defaultTier: null,
    isDefault: false,
  },
  {
    id: "sonnet",
    model: "sonnet",
    displayName: "Sonnet",
    description: "Balanced speed and quality",
    efforts: efforts(EFFORTS),
    defaultEffort: "high",
    tiers: [],
    defaultTier: null,
    isDefault: false,
  },
];

export const fallbackSettings: CodiconSettings = {
  workspace: "/Users/you/Projects/codicon",
  codexPath: "codex",
  claudePath: "",
  controllerEnabled: true,
  hudEnabled: true,
  hudBounds: null,
  quitOnWindowClose: false,
  deadzone: 0.42,
  permissionMode: "auto",
  target: { mode: "auto", manual: "codex" },
  providers: {
    codex: {
      slots: [
        { key: "sol", label: "SOL", modelId: "gpt-5.6-sol", color: "#ff7a59" },
        { key: "terra", label: "TERRA", modelId: "gpt-5.6-terra", color: "#9bd6bd" },
        { key: "luna", label: "LUNA", modelId: "gpt-5.6-luna", color: "#9ba7ff" },
      ],
    },
    claude: {
      slots: [
        { key: "fable", label: "FABLE", modelId: "claude-fable-5", color: "#d97757" },
        { key: "opus", label: "OPUS", modelId: "opus", color: "#9bd6bd" },
        { key: "sonnet", label: "SONNET", modelId: "sonnet", color: "#9ba7ff" },
      ],
    },
  },
  bindings: { primary: 0, cancel: 1, focusComposer: 2, newThread: 3, powerWheel: 4, pushToTalk: 5, fastMode: 11, settings: 9, switchTarget: 8 },
};

export const previewBootstrap: BootstrapData = {
  platform: "preview",
  version: "0.2.0",
  codexPath: "codex",
  settings: fallbackSettings,
  providers: {
    codex: { available: true, models: fallbackCodexModels, threads: [], accountLabel: "CHATGPT" },
    claude: { available: true, models: fallbackClaudeModels, threads: [], accountLabel: "CLAUDE" },
  },
};
