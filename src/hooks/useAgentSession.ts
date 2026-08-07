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
  voice?: boolean;
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

export type SessionConnection = "connecting" | "ready" | "error" | "preview" | "unavailable";

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

/**
 * One provider's live session state, driven entirely by the normalized event stream from the main
 * process. Two instances run side by side — one per backend — and the active target picks which
 * one the controller, composer, and overlays operate on.
 */
export function useAgentSession(provider: AgentProvider, bootstrap: ProviderBootstrap | null, settings: CodiconSettings | null) {
  const preview = typeof window !== "undefined" && !window.codicon;
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [inputRequest, setInputRequest] = useState<UserInputRequest | null>(null);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [selectedEffort, setSelectedEffort] = useState("medium");
  const [selectedServiceTier, setSelectedServiceTier] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [exited, setExited] = useState(false);
  const threadIdRef = useRef<string | null>(null);
  const activeTurnRef = useRef<string | null>(null);
  threadIdRef.current = threadId;
  activeTurnRef.current = activeTurnId;

  const models = useMemo(() => bootstrap?.models || [], [bootstrap]);
  const slots = useMemo(() => {
    const raw = settings?.providers[provider]?.slots || [];
    return reconcileSlots(raw, models);
  }, [settings, provider, models]);

  const connection: SessionConnection = preview
    ? "preview"
    : !bootstrap
      ? "connecting"
      : !bootstrap.available
        ? "unavailable"
        : exited
          ? "error"
          : "ready";

  const selectedModel = useMemo(
    () => modelForSlot(slots[selectedSlot] || slots[0], models) || models[0],
    [slots, models, selectedSlot],
  );

  // Seed threads and the default effort once the provider's bootstrap arrives.
  useEffect(() => {
    if (!bootstrap) return;
    setThreads(bootstrap.threads || []);
    const initialModel = modelForSlot((settings?.providers[provider]?.slots || [])[0], bootstrap.models)
      || bootstrap.models.find((model) => model.isDefault)
      || bootstrap.models[0];
    if (initialModel) {
      setSelectedEffort(initialModel.defaultEffort || initialModel.efforts[0]?.id || "medium");
    }
    // The stored slots may point at models that no longer exist; selection index stays 0.
  }, [bootstrap]); // eslint-disable-line react-hooks/exhaustive-deps

  const appendActivity = useCallback((next: ActivityItem) => {
    setActivity((current) => {
      const found = current.findIndex((item) => item.id === next.id);
      if (found < 0) return [next, ...current].slice(0, 30);
      const copy = [...current];
      copy[found] = { ...copy[found], ...next };
      return copy;
    });
  }, []);

  const handleEvent = useCallback((event: AgentEvent) => {
    if (event.provider !== provider) return;
    // Conversation-scoped events from a thread this view is no longer showing (a resumed-away
    // session's tail, or a handle being torn down) must not corrupt the current transcript.
    // Events without a threadId (codex notifications) are inherently current-thread.
    const conversationKinds = ["turn-started", "turn-completed", "message-delta", "message-completed", "activity", "activity-status"];
    if (conversationKinds.includes(event.kind) && event.threadId && threadIdRef.current && event.threadId !== threadIdRef.current) {
      return;
    }
    switch (event.kind) {
      case "status":
        if (event.state === "exit") {
          setExited(true);
          setActiveTurnId(null);
          activeTurnRef.current = null;
        } else if (event.state === "ready") {
          setExited(false);
        }
        break;
      case "turn-started":
        setActiveTurnId(event.turnId);
        activeTurnRef.current = event.turnId;
        break;
      case "turn-completed":
        setActiveTurnId(null);
        activeTurnRef.current = null;
        setMessages((current) => current.map((message) => ({ ...message, streaming: false })));
        break;
      case "message-delta":
        setMessages((current) => {
          const index = current.findIndex((message) => message.id === event.itemId);
          if (index < 0) return [...current, { id: event.itemId, role: "assistant", text: event.delta, streaming: true }];
          const copy = [...current];
          copy[index] = { ...copy[index], text: copy[index].text + event.delta, streaming: true };
          return copy;
        });
        break;
      case "message-completed":
        setMessages((current) => {
          const next = { id: event.itemId, role: "assistant" as const, text: event.text, streaming: false };
          const index = current.findIndex((message) => message.id === event.itemId);
          if (index < 0) return [...current, next];
          const copy = [...current];
          copy[index] = next;
          return copy;
        });
        break;
      case "activity":
        appendActivity({ id: event.id, type: event.type, title: event.title, detail: event.detail, status: event.status });
        break;
      case "activity-status":
        setActivity((current) => current.map((item) => (item.id === event.id ? { ...item, status: event.status } : item)));
        break;
      case "approval":
        setApproval({ id: event.id, title: event.title, command: event.command, reason: event.reason });
        break;
      case "approval-dismissed":
        setApproval((current) => (current && current.id === event.id ? null : current));
        break;
      case "question":
        setInputRequest({ id: event.id, questions: event.questions });
        break;
      case "voice-started":
        setVoiceActive(true);
        break;
      case "voice-transcript-delta":
        setLiveTranscript((current) => current + event.delta);
        break;
      case "voice-transcript-done":
        setLiveTranscript(event.text);
        break;
      case "voice-closed":
        setVoiceActive(false);
        break;
      case "voice-error":
        setVoiceActive(false);
        setError(event.message);
        break;
      case "error":
        setError(event.message);
        break;
      case "log":
        break;
    }
  }, [provider, appendActivity]);

  useEffect(() => {
    const unsubscribe = window.codicon?.onAgentEvent(handleEvent);
    return () => unsubscribe?.();
  }, [handleEvent]);

  const ensureThread = useCallback(async (): Promise<string> => {
    if (threadIdRef.current) return threadIdRef.current;
    if (!selectedModel) throw new Error("モデルを準備中です");
    if (!window.codicon) {
      setThreadId("preview-thread");
      threadIdRef.current = "preview-thread";
      return "preview-thread";
    }
    const result = await window.codicon.startThread({
      provider,
      model: selectedModel.model,
      effort: selectedEffort,
      tier: selectedServiceTier,
    });
    if (!result.threadId) throw new Error("スレッドを開始できませんでした");
    setThreadId(result.threadId);
    threadIdRef.current = result.threadId;
    return result.threadId;
  }, [provider, selectedModel, selectedEffort, selectedServiceTier]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !selectedModel) return;
    const id = `local-${Date.now()}`;
    setMessages((current) => [...current, { id, role: "user", text: trimmed }]);
    setError(null);
    if (!window.codicon) {
      setActiveTurnId("preview-turn");
      window.setTimeout(() => {
        setMessages((current) => [...current, { id: `demo-${Date.now()}`, role: "assistant", text: "了解しました。コントローラ入力を受け取り、選択中のモデル設定で作業を開始します。" }]);
        setActiveTurnId(null);
      }, 650);
      return;
    }
    try {
      const currentThread = await ensureThread();
      const result = await window.codicon.sendMessage({
        provider,
        threadId: currentThread,
        activeTurnId: activeTurnRef.current,
        text: trimmed,
        model: selectedModel.model,
        effort: selectedEffort,
        tier: selectedServiceTier,
      });
      if (result.turnId) {
        setActiveTurnId(result.turnId);
        activeTurnRef.current = result.turnId;
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    }
  }, [provider, ensureThread, selectedModel, selectedEffort, selectedServiceTier]);

  const selectPower = useCallback(async (slotIndex: number, effort?: string) => {
    if (!slots.length) return;
    const boundedIndex = Math.max(0, Math.min(slots.length - 1, slotIndex));
    const nextModel = modelForSlot(slots[boundedIndex], models) || models[0];
    const supported = nextModel?.efforts.map((option) => option.id) || [];
    const nextEffort = effort && supported.includes(effort)
      ? effort
      : supported.includes(selectedEffort)
        ? selectedEffort
        : nextModel?.defaultEffort || supported[0] || "medium";
    const nextServiceTier = selectedServiceTier && nextModel?.tiers.some((tier) => tier.id === selectedServiceTier) ? selectedServiceTier : null;
    setSelectedSlot(boundedIndex);
    setSelectedEffort(nextEffort);
    setSelectedServiceTier(nextServiceTier);
    if (window.codicon && nextModel) {
      try {
        await window.codicon.updatePower({ provider, threadId: threadIdRef.current, model: nextModel.model, effort: nextEffort, tier: nextServiceTier });
      } catch (powerError) {
        setError(powerError instanceof Error ? powerError.message : String(powerError));
      }
    }
  }, [provider, slots, models, selectedEffort, selectedServiceTier]);

  const toggleFast = useCallback(async () => {
    if (!selectedModel) return;
    const fastTier = selectedModel.tiers.find((tier) => tier.name.toLowerCase().includes("fast") || tier.id.toLowerCase() === "fast" || tier.id.toLowerCase() === "priority");
    if (!fastTier) {
      setError(`${selectedModel.displayName} は Fast モードに対応していません`);
      return;
    }
    const nextTier = selectedServiceTier === fastTier.id ? null : fastTier.id;
    setSelectedServiceTier(nextTier);
    if (window.codicon) {
      try {
        await window.codicon.updatePower({ provider, threadId: threadIdRef.current, model: selectedModel.model, effort: selectedEffort, tier: nextTier });
      } catch (tierError) {
        setError(tierError instanceof Error ? tierError.message : String(tierError));
      }
    }
  }, [provider, selectedModel, selectedServiceTier, selectedEffort]);

  const newThread = useCallback(() => {
    setThreadId(null);
    threadIdRef.current = null;
    setActiveTurnId(null);
    activeTurnRef.current = null;
    setMessages([]);
    setActivity([]);
    setLiveTranscript("");
    setError(null);
  }, []);

  const resumeThread = useCallback(async (summary: ThreadSummary) => {
    if (!window.codicon) return;
    try {
      const result = await window.codicon.resumeThread({ provider, threadId: summary.id });
      setThreadId(result.threadId);
      threadIdRef.current = result.threadId;
      setMessages(result.messages.map((message) => ({ id: message.id, role: message.role, text: message.text })));
      setActivity([]);
      setError(null);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : String(resumeError));
    }
  }, [provider]);

  const interrupt = useCallback(async () => {
    if (!window.codicon || !threadIdRef.current || !activeTurnRef.current) return;
    try {
      await window.codicon.interrupt({ provider, threadId: threadIdRef.current, turnId: activeTurnRef.current });
    } catch (interruptError) {
      setError(interruptError instanceof Error ? interruptError.message : String(interruptError));
    }
  }, [provider]);

  const respondApproval = useCallback(async (decision: "accept" | "acceptForSession" | "decline" | "cancel") => {
    if (!approval) return;
    try {
      await window.codicon?.respond({ provider, id: approval.id, decision });
    } catch (respondError) {
      setError(respondError instanceof Error ? respondError.message : String(respondError));
    }
    setApproval(null);
  }, [provider, approval]);

  const answerUserInput = useCallback(async (answers: Record<string, string>) => {
    if (!inputRequest) return;
    try {
      await window.codicon?.respond({ provider, id: inputRequest.id, answers });
    } catch (respondError) {
      setError(respondError instanceof Error ? respondError.message : String(respondError));
    }
    setInputRequest(null);
  }, [provider, inputRequest]);

  const answerUserInputDefaults = useCallback(() => {
    if (!inputRequest) return;
    const answers = Object.fromEntries(inputRequest.questions.map((question) => [question.id, question.options?.[0]?.label || ""]));
    void answerUserInput(answers);
  }, [inputRequest, answerUserInput]);

  const refreshThreads = useCallback(async () => {
    if (!window.codicon) return;
    try {
      const response = await window.codicon.listThreads(provider);
      if (response?.data) setThreads(response.data);
    } catch {
      // The rail keeps its last contents when a provider is temporarily unavailable.
    }
  }, [provider]);

  return {
    provider,
    connection,
    available: bootstrap?.available ?? false,
    reason: bootstrap?.reason || "",
    accountLabel: bootstrap?.accountLabel || (provider === "codex" ? "CHATGPT" : "CLAUDE"),
    error, setError,
    models, slots, threads,
    threadId, activeTurnId, messages, activity, approval, inputRequest,
    selectedSlot, selectedEffort, selectedServiceTier, selectedModel,
    liveTranscript, setLiveTranscript, voiceActive, setVoiceActive,
    ensureThread, sendMessage, selectPower, toggleFast, newThread, resumeThread,
    interrupt, respondApproval, answerUserInput, answerUserInputDefaults, refreshThreads,
  };
}

export type AgentSession = ReturnType<typeof useAgentSession>;
