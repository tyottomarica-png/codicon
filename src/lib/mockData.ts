import type { BootstrapData, CodexModel, CodiconSettings } from "../types/codicon";

export const fallbackModels: CodexModel[] = [
  {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "Sol",
    description: "Complex, open-ended work with detail and polish",
    hidden: false,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: "medium",
    serviceTiers: [{ id: "priority", name: "Fast", description: "Prioritize response speed" }],
    defaultServiceTier: null,
    isDefault: true,
  },
  {
    id: "gpt-5.6-terra",
    model: "gpt-5.6-terra",
    displayName: "Terra",
    description: "Pragmatic everyday workhorse",
    hidden: false,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: "medium",
    serviceTiers: [{ id: "priority", name: "Fast", description: "Prioritize response speed" }],
    defaultServiceTier: null,
    isDefault: false,
  },
  {
    id: "gpt-5.6-luna",
    model: "gpt-5.6-luna",
    displayName: "Luna",
    description: "Clear, repeatable and high-volume tasks",
    hidden: false,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: "medium",
    serviceTiers: [{ id: "priority", name: "Fast", description: "Prioritize response speed" }],
    defaultServiceTier: null,
    isDefault: false,
  },
];

export const fallbackSettings: CodiconSettings = {
  workspace: "/Users/you/Projects/codicon",
  codexPath: "codex",
  controllerEnabled: true,
  hudEnabled: true,
  hudBounds: null,
  quitOnWindowClose: false,
  deadzone: 0.42,
  permissionMode: "auto",
  modelSlots: [
    { key: "sol", label: "SOL", modelId: "gpt-5.6-sol", color: "#ff7a59" },
    { key: "terra", label: "TERRA", modelId: "gpt-5.6-terra", color: "#9bd6bd" },
    { key: "luna", label: "LUNA", modelId: "gpt-5.6-luna", color: "#9ba7ff" },
  ],
  bindings: { primary: 0, cancel: 1, focusComposer: 2, newThread: 3, powerWheel: 4, pushToTalk: 5, fastMode: 11, settings: 9 },
};

export const previewBootstrap: BootstrapData = {
  platform: "preview",
  version: "0.1.0",
  codexPath: "codex",
  settings: fallbackSettings,
  models: { data: fallbackModels },
  account: {},
  config: {},
  threads: { data: [] },
};
