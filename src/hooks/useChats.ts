import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentEvent,
  AgentModel,
  AgentProvider,
  CodiconSettings,
  InputQuestion,
  ModelSlot,
  ProviderBootstrap,
  ThreadSummary,
} from "../types/codicon";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
};

export type ActivityItem = {
  id: string;
  type: string;
  title: string;
  detail: string;
  status: "running" | "completed" | "failed";
};

export type ApprovalRequest = {
  id: number | string;
  title: string;
  command: string;
  reason: string;
};

export type UserInputRequest = {
  id: number | string;
  questions: InputQuestion[];
};

/**
 * The live state of one chat, as an Agent Key shows it.
 * `waiting` outranks everything: a chat blocked on the user is the one worth switching to.
 */
export type ChatStatus = "idle" | "thinking" | "running" | "waiting" | "done" | "error";

export type Chat = {
  id: string;
  provider: AgentProvider;
  threadId: string | null;
  title: string;
  slot: number;
  effort: string;
  tier: string | null;
  messages: ChatMessage[];
  activity: ActivityItem[];
  approval: ApprovalRequest | null;
  inputRequest: UserInputRequest | null;
  activeTurnId: string | null;
  /** Output arrived while this chat was not on screen. */
  unread: boolean;
  error: string | null;
};

function modelForSlot(slot: ModelSlot | undefined, models: AgentModel[]): AgentModel | undefined {
  if (!slot) return undefined;
  return models.find((model) => model.model === slot.modelId || model.id === slot.modelId);
}

export function reconcileSlots(slots: ModelSlot[], models: AgentModel[]): ModelSlot[] {
  if (!models.length) return slots;
  return slots.map((slot, index) => {
    if (modelForSlot(slot, models)) return slot;
    const semanticMatch = models.find((model) => `${model.model} ${model.displayName}`.toLowerCase().includes(slot.key.toLowerCase()));
    const fallback = semanticMatch || models[index] || models[0];
    return { ...slot, modelId: fallback.model };
  });
}

/** Derive the Agent Key colour state from a chat's contents. */
export function chatStatus(chat: Chat): ChatStatus {
  if (chat.approval || chat.inputRequest) return "waiting";
  if (chat.error) return "error";
  if (chat.activeTurnId) {
    return chat.activity.some((item) => item.status === "running") ? "running" : "thinking";
  }
  if (chat.unread) return "done";
  return "idle";
}

/** First line of the first user message, so a key is recognisable at a glance. */
export function deriveTitle(chat: Chat): string {
  if (chat.title) return chat.title;
  const first = chat.messages.find((message) => message.role === "user");
  if (!first) return "New chat";
  const line = first.text.trim().split("\n")[0];
  return line.length > 34 ? `${line.slice(0, 33)}…` : line || "New chat";
}

let chatCounter = 0;
function nextChatId() {
  chatCounter += 1;
  return `chat-${chatCounter}`;
}

/**
 * Every chat across both backends, running concurrently.
 *
 * This is the Agent Keys model: several agents are live at once and each one's status is visible
 * without switching to it, so the controller can jump to whichever one needs attention.
 */
export function useChats(
  bootstraps: Record<AgentProvider, ProviderBootstrap | null>,
  settings: CodiconSettings | null,
) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChatId;
  // Chats are addressed by threadId on the wire and by local id in the UI.
  const threadIndex = useRef(new Map<string, string>());

  const modelsFor = useCallback(
    (provider: AgentProvider) => bootstraps[provider]?.models || [],
    [bootstraps],
  );

  const slotsFor = useCallback(
    (provider: AgentProvider) => reconcileSlots(settings?.providers[provider]?.slots || [], modelsFor(provider)),
    [settings, modelsFor],
  );

  const patchChat = useCallback((chatId: string, patch: Partial<Chat> | ((chat: Chat) => Partial<Chat>)) => {
    setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, ...(typeof patch === "function" ? patch(chat) : patch) } : chat)));
  }, []);

  const createChat = useCallback((provider: AgentProvider): Chat => {
    const models = modelsFor(provider);
    const slots = slotsFor(provider);
    const model = modelForSlot(slots[0], models) || models.find((entry) => entry.isDefault) || models[0];
    return {
      id: nextChatId(),
      provider,
      threadId: null,
      title: "",
      slot: 0,
      effort: model?.defaultEffort || model?.efforts[0]?.id || "medium",
      tier: null,
      messages: [],
      activity: [],
      approval: null,
      inputRequest: null,
      activeTurnId: null,
      unread: false,
      error: null,
    };
  }, [modelsFor, slotsFor]);

  // Open one chat per available backend so the rail is never empty.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !settings) return;
    const available = (["codex", "claude"] as AgentProvider[]).filter((provider) => bootstraps[provider]?.available);
    if (!available.length) return;
    seeded.current = true;
    const initial = available.map(createChat);
    setChats(initial);
    setActiveChatId(initial[0].id);
  }, [bootstraps, settings, createChat]);

  const handleEvent = useCallback((event: AgentEvent) => {
    const chatId = event.threadId ? threadIndex.current.get(`${event.provider}:${event.threadId}`) : undefined;
    // Provider-wide events with no thread (a backend dying) touch every chat of that provider.
    const matches = (chat: Chat) => (chatId ? chat.id === chatId : !event.threadId && chat.provider === event.provider);

    setChats((current) => current.map((chat) => {
      if (!matches(chat)) return chat;
      const isActive = chat.id === activeChatIdRef.current;
      switch (event.kind) {
        case "status":
          if (event.state === "exit") return { ...chat, activeTurnId: null };
          return chat;
        case "turn-started":
          return { ...chat, activeTurnId: event.turnId, error: null };
        case "turn-completed":
          return {
            ...chat,
            activeTurnId: null,
            messages: chat.messages.map((message) => ({ ...message, streaming: false })),
            unread: chat.unread || !isActive,
          };
        case "message-delta": {
          const index = chat.messages.findIndex((message) => message.id === event.itemId);
          const messages = index < 0
            ? [...chat.messages, { id: event.itemId, role: "assistant" as const, text: event.delta, streaming: true }]
            : chat.messages.map((message, at) => (at === index ? { ...message, text: message.text + event.delta, streaming: true } : message));
          return { ...chat, messages, unread: chat.unread || !isActive };
        }
        case "message-completed": {
          const next = { id: event.itemId, role: "assistant" as const, text: event.text, streaming: false };
          const index = chat.messages.findIndex((message) => message.id === event.itemId);
          const messages = index < 0 ? [...chat.messages, next] : chat.messages.map((message, at) => (at === index ? next : message));
          return { ...chat, messages, unread: chat.unread || !isActive };
        }
        case "activity": {
          const item = { id: event.id, type: event.type, title: event.title, detail: event.detail, status: event.status };
          const index = chat.activity.findIndex((entry) => entry.id === item.id);
          const activity = index < 0
            ? [item, ...chat.activity].slice(0, 30)
            : chat.activity.map((entry, at) => (at === index ? { ...entry, ...item } : entry));
          return { ...chat, activity };
        }
        case "activity-status":
          return { ...chat, activity: chat.activity.map((entry) => (entry.id === event.id ? { ...entry, status: event.status } : entry)) };
        case "approval":
          return { ...chat, approval: { id: event.id, title: event.title, command: event.command, reason: event.reason } };
        case "approval-dismissed":
          return chat.approval?.id === event.id ? { ...chat, approval: null } : chat;
        case "question":
          return { ...chat, inputRequest: { id: event.id, questions: event.questions } };
        case "error":
          return { ...chat, error: event.message };
        default:
          return chat;
      }
    }));
  }, []);

  useEffect(() => {
    const unsubscribe = window.codicon?.onAgentEvent(handleEvent);
    return () => unsubscribe?.();
  }, [handleEvent]);

  const activeChat = useMemo(() => chats.find((chat) => chat.id === activeChatId) || null, [chats, activeChatId]);

  const selectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, unread: false } : chat)));
  }, []);

  const newChat = useCallback((provider: AgentProvider) => {
    const chat = createChat(provider);
    setChats((current) => [...current, chat]);
    setActiveChatId(chat.id);
    return chat.id;
  }, [createChat]);

  const closeChat = useCallback((chatId: string) => {
    const chat = chats.find((entry) => entry.id === chatId);
    if (chat?.threadId) {
      threadIndex.current.delete(`${chat.provider}:${chat.threadId}`);
      void window.codicon?.closeThread({ provider: chat.provider, threadId: chat.threadId }).catch(() => undefined);
    }
    setChats((current) => {
      const next = current.filter((entry) => entry.id !== chatId);
      if (activeChatIdRef.current === chatId) setActiveChatId(next[0]?.id ?? null);
      return next;
    });
  }, [chats]);

  /**
   * Follow the focused application to that backend's newest chat.
   *
   * Deliberately a no-op when a chat of that provider is already selected: re-selecting on every
   * tracker tick would drag the selection off whichever chat you deliberately switched to.
   */
  const focusProvider = useCallback((provider: AgentProvider) => {
    if (activeChatIdRef.current) {
      const active = chats.find((chat) => chat.id === activeChatIdRef.current);
      if (active?.provider === provider) return;
    }
    const candidates = chats.filter((chat) => chat.provider === provider);
    if (!candidates.length) {
      if (bootstraps[provider]?.available) newChat(provider);
      return;
    }
    selectChat(candidates[candidates.length - 1].id);
  }, [chats, bootstraps, newChat, selectChat]);

  const ensureThread = useCallback(async (chat: Chat): Promise<string> => {
    if (chat.threadId) return chat.threadId;
    const models = modelsFor(chat.provider);
    const model = modelForSlot(slotsFor(chat.provider)[chat.slot], models) || models[0];
    if (!model) throw new Error("モデルを準備中です");
    if (!window.codicon) {
      const preview = `preview-${chat.id}`;
      threadIndex.current.set(`${chat.provider}:${preview}`, chat.id);
      patchChat(chat.id, { threadId: preview });
      return preview;
    }
    const result = await window.codicon.startThread({ provider: chat.provider, model: model.model, effort: chat.effort, tier: chat.tier });
    if (!result.threadId) throw new Error("スレッドを開始できませんでした");
    threadIndex.current.set(`${chat.provider}:${result.threadId}`, chat.id);
    patchChat(chat.id, { threadId: result.threadId });
    return result.threadId;
  }, [modelsFor, slotsFor, patchChat]);

  const sendMessage = useCallback(async (chatId: string, text: string) => {
    const chat = chats.find((entry) => entry.id === chatId);
    const trimmed = text.trim();
    if (!chat || !trimmed) return;
    const models = modelsFor(chat.provider);
    const model = modelForSlot(slotsFor(chat.provider)[chat.slot], models) || models[0];
    if (!model) return;
    patchChat(chat.id, (current) => ({
      messages: [...current.messages, { id: `local-${Date.now()}`, role: "user" as const, text: trimmed }],
      error: null,
    }));
    if (!window.codicon) {
      patchChat(chat.id, { activeTurnId: "preview-turn" });
      window.setTimeout(() => patchChat(chat.id, (current) => ({
        activeTurnId: null,
        messages: [...current.messages, { id: `demo-${Date.now()}`, role: "assistant" as const, text: "了解しました。選択中のモデル設定で作業を開始します。" }],
      })), 650);
      return;
    }
    try {
      const threadId = await ensureThread(chat);
      const result = await window.codicon.sendMessage({
        provider: chat.provider,
        threadId,
        activeTurnId: chat.activeTurnId,
        text: trimmed,
        model: model.model,
        effort: chat.effort,
        tier: chat.tier,
      });
      if (result.turnId) patchChat(chat.id, { activeTurnId: result.turnId });
    } catch (error) {
      patchChat(chat.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }, [chats, modelsFor, slotsFor, patchChat, ensureThread]);

  const selectPower = useCallback(async (chatId: string, slotIndex: number, effort?: string) => {
    const chat = chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const models = modelsFor(chat.provider);
    const slots = slotsFor(chat.provider);
    const bounded = Math.max(0, Math.min(slots.length - 1, slotIndex));
    const model = modelForSlot(slots[bounded], models) || models[0];
    const supported = model?.efforts.map((option) => option.id) || [];
    const nextEffort = effort && supported.includes(effort)
      ? effort
      : supported.includes(chat.effort)
        ? chat.effort
        : model?.defaultEffort || supported[0] || "medium";
    const nextTier = chat.tier && model?.tiers.some((tier) => tier.id === chat.tier) ? chat.tier : null;
    patchChat(chat.id, { slot: bounded, effort: nextEffort, tier: nextTier });
    if (window.codicon && model) {
      try {
        await window.codicon.updatePower({ provider: chat.provider, threadId: chat.threadId, model: model.model, effort: nextEffort, tier: nextTier });
      } catch (error) {
        patchChat(chat.id, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }, [chats, modelsFor, slotsFor, patchChat]);

  const toggleFast = useCallback(async (chatId: string) => {
    const chat = chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const models = modelsFor(chat.provider);
    const model = modelForSlot(slotsFor(chat.provider)[chat.slot], models) || models[0];
    const fastTier = model?.tiers.find((tier) => tier.name.toLowerCase().includes("fast") || tier.id.toLowerCase() === "fast" || tier.id.toLowerCase() === "priority");
    if (!fastTier) {
      patchChat(chat.id, { error: `${model?.displayName || "このモデル"} は Fast モードに対応していません` });
      return;
    }
    const nextTier = chat.tier === fastTier.id ? null : fastTier.id;
    patchChat(chat.id, { tier: nextTier });
    if (window.codicon && model) {
      try {
        await window.codicon.updatePower({ provider: chat.provider, threadId: chat.threadId, model: model.model, effort: chat.effort, tier: nextTier });
      } catch (error) {
        patchChat(chat.id, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }, [chats, modelsFor, slotsFor, patchChat]);

  const interrupt = useCallback(async (chatId: string) => {
    const chat = chats.find((entry) => entry.id === chatId);
    if (!chat?.threadId || !chat.activeTurnId || !window.codicon) return;
    try {
      await window.codicon.interrupt({ provider: chat.provider, threadId: chat.threadId, turnId: chat.activeTurnId });
    } catch (error) {
      patchChat(chat.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }, [chats, patchChat]);

  const respondApproval = useCallback(async (chatId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel") => {
    const chat = chats.find((entry) => entry.id === chatId);
    if (!chat?.approval) return;
    const id = chat.approval.id;
    patchChat(chat.id, { approval: null });
    try {
      await window.codicon?.respond({ provider: chat.provider, id, decision });
    } catch (error) {
      patchChat(chat.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }, [chats, patchChat]);

  const answerUserInput = useCallback(async (chatId: string, answers: Record<string, string>) => {
    const chat = chats.find((entry) => entry.id === chatId);
    if (!chat?.inputRequest) return;
    const id = chat.inputRequest.id;
    patchChat(chat.id, { inputRequest: null });
    try {
      await window.codicon?.respond({ provider: chat.provider, id, answers });
    } catch (error) {
      patchChat(chat.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }, [chats, patchChat]);

  const resumeThread = useCallback(async (provider: AgentProvider, summary: ThreadSummary) => {
    if (!window.codicon) return;
    const chat = createChat(provider);
    setChats((current) => [...current, { ...chat, title: summary.name || summary.preview || "" }]);
    setActiveChatId(chat.id);
    try {
      const result = await window.codicon.resumeThread({ provider, threadId: summary.id });
      threadIndex.current.set(`${provider}:${result.threadId}`, chat.id);
      patchChat(chat.id, {
        threadId: result.threadId,
        messages: result.messages.map((message) => ({ id: message.id, role: message.role, text: message.text })),
      });
    } catch (error) {
      patchChat(chat.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }, [createChat, patchChat]);

  const clearError = useCallback((chatId: string) => patchChat(chatId, { error: null }), [patchChat]);

  return {
    chats, activeChat, activeChatId,
    selectChat, newChat, closeChat, focusProvider,
    sendMessage, selectPower, toggleFast, interrupt,
    respondApproval, answerUserInput, resumeThread, clearError,
    modelsFor, slotsFor,
  };
}

export type ChatsController = ReturnType<typeof useChats>;
