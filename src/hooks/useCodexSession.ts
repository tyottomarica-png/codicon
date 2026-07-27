import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fallbackModels, fallbackSettings, previewBootstrap } from "../lib/mockData";
import type { BootstrapData, CodexEvent, CodexModel, CodiconSettings, ModelSlot, ThreadSummary } from "../types/codicon";

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
  method: string;
  title: string;
  command: string;
  reason: string;
  permissions?: Record<string, unknown>;
};

export type InputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};

export type UserInputRequest = {
  id: number | string;
  questions: InputQuestion[];
};

function modelForSlot(slot: ModelSlot, models: CodexModel[]): CodexModel | undefined {
  return models.find((model) => model.model === slot.modelId || model.id === slot.modelId);
}

function reconcileSlots(slots: ModelSlot[], models: CodexModel[]): ModelSlot[] {
  if (!models.length) return slots;
  return slots.map((slot, index) => {
    if (modelForSlot(slot, models)) return slot;
    const semanticMatch = models.find((model) => `${model.model} ${model.displayName}`.toLowerCase().includes(slot.key.toLowerCase()));
    const fallback = semanticMatch || models[index] || models[0];
    return { ...slot, modelId: fallback.model };
  });
}

function textFromUserContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.filter((item): item is { type: string; text: string } => Boolean(item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item)).map((item) => item.text).join("\n");
}

function historyFromThread(response: Record<string, unknown>): ChatMessage[] {
  const thread = response.thread as { turns?: Array<{ items?: Array<Record<string, unknown>> }> } | undefined;
  const output: ChatMessage[] = [];
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") output.push({ id: String(item.id), role: "user", text: textFromUserContent(item.content) });
      if (item.type === "agentMessage") output.push({ id: String(item.id), role: "assistant", text: String(item.text || "") });
    }
  }
  return output;
}

export function useCodexSession() {
  const [connection, setConnection] = useState<"connecting" | "ready" | "error" | "preview">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CodiconSettings | null>(null);
  const [models, setModels] = useState<CodexModel[]>([]);
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
  const [accountLabel, setAccountLabel] = useState("CHATGPT");
  const threadIdRef = useRef<string | null>(null);
  const activeTurnRef = useRef<string | null>(null);
  threadIdRef.current = threadId;
  activeTurnRef.current = activeTurnId;

  const selectedModel = useMemo(() => {
    if (!settings) return models[0];
    return modelForSlot(settings.modelSlots[selectedSlot] || settings.modelSlots[0], models) || models[0];
  }, [settings, models, selectedSlot]);

  const appendActivity = useCallback((next: ActivityItem) => {
    setActivity((current) => {
      const found = current.findIndex((item) => item.id === next.id);
      if (found < 0) return [next, ...current].slice(0, 30);
      const copy = [...current];
      copy[found] = { ...copy[found], ...next };
      return copy;
    });
  }, []);

  const handleEvent = useCallback((event: CodexEvent) => {
    if (event.kind === "exit") {
      setConnection("error");
      setError("Codex app-server との接続が終了しました");
      return;
    }
    if (event.kind === "log") return;
    const params = (event.params || {}) as Record<string, unknown>;
    if (event.kind === "request" && event.id !== undefined) {
      if (event.method === "item/tool/requestUserInput") {
        setInputRequest({ id: event.id, questions: (params.questions as InputQuestion[]) || [] });
        return;
      }
      const approvalMethods = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval", "execCommandApproval", "applyPatchApproval"];
      if (!approvalMethods.includes(event.method || "")) {
        if (event.method === "mcpServer/elicitation/request") {
          void window.codicon?.respond({ id: event.id, result: { action: "cancel", content: null, _meta: null } });
        } else if (event.method === "item/tool/call") {
          void window.codicon?.respond({ id: event.id, result: { contentItems: [{ type: "inputText", text: "Codicon does not expose client-side dynamic tools." }], success: false } });
        }
        setError(`未対応の Codex リクエストを安全に停止しました: ${event.method || "unknown"}`);
        return;
      }
      const command = typeof params.command === "string" ? params.command : "Codex が操作の許可を求めています";
      const method = event.method || "approval";
      setApproval({
        id: event.id,
        method,
        title: method.includes("fileChange") ? "ファイル変更の承認" : method.includes("permissions") ? "追加権限の承認" : "コマンド実行の承認",
        command,
        reason: typeof params.reason === "string" ? params.reason : "この操作は現在の安全設定の外側にあります。",
        permissions: event.method === "item/permissions/requestApproval" ? params.permissions as Record<string, unknown> : undefined,
      });
      return;
    }
    switch (event.method) {
      case "turn/started": {
        const turn = params.turn as { id?: string } | undefined;
        if (turn?.id) {
          setActiveTurnId(turn.id);
          activeTurnRef.current = turn.id;
        }
        break;
      }
      case "turn/completed":
        setActiveTurnId(null);
        activeTurnRef.current = null;
        setMessages((current) => current.map((message) => ({ ...message, streaming: false })));
        break;
      case "item/agentMessage/delta": {
        const id = String(params.itemId || "agent-stream");
        const delta = String(params.delta || "");
        setMessages((current) => {
          const index = current.findIndex((message) => message.id === id);
          if (index < 0) return [...current, { id, role: "assistant", text: delta, streaming: true }];
          const copy = [...current];
          copy[index] = { ...copy[index], text: copy[index].text + delta, streaming: true };
          return copy;
        });
        break;
      }
      case "item/started":
      case "item/completed": {
        const item = params.item as Record<string, unknown> | undefined;
        if (!item?.id || !item.type) break;
        const done = event.method === "item/completed";
        if (item.type === "agentMessage" && done) {
          const id = String(item.id);
          setMessages((current) => {
            const next = { id, role: "assistant" as const, text: String(item.text || ""), streaming: false };
            const index = current.findIndex((message) => message.id === id);
            if (index < 0) return [...current, next];
            const copy = [...current];
            copy[index] = next;
            return copy;
          });
        } else if (["commandExecution", "fileChange", "mcpToolCall", "webSearch", "collabAgentToolCall"].includes(String(item.type))) {
          const titleMap: Record<string, string> = {
            commandExecution: "COMMAND",
            fileChange: "FILES",
            mcpToolCall: "TOOL",
            webSearch: "SEARCH",
            collabAgentToolCall: "ULTRA AGENT",
          };
          const detail = String(item.command || item.tool || item.server || (item.type === "fileChange" ? `${(item.changes as unknown[])?.length || 0} changes` : item.type));
          appendActivity({ id: String(item.id), type: String(item.type), title: titleMap[String(item.type)] || String(item.type), detail, status: done ? "completed" : "running" });
        }
        break;
      }
      case "thread/realtime/started":
        setVoiceActive(true);
        break;
      case "thread/realtime/transcript/delta":
        if (params.role === "user") setLiveTranscript((current) => current + String(params.delta || ""));
        break;
      case "thread/realtime/transcript/done":
        if (params.role === "user") setLiveTranscript(String(params.text || ""));
        break;
      case "thread/realtime/closed":
        setVoiceActive(false);
        break;
      case "thread/realtime/error":
        setVoiceActive(false);
        setError(String(params.message || "音声セッションでエラーが発生しました"));
        break;
      case "error":
        setError(String(params.message || "Codex でエラーが発生しました"));
        break;
    }
  }, [appendActivity]);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.codicon?.onEvent(handleEvent);
    const load = async () => {
      try {
        const bootstrap: BootstrapData = window.codicon ? await window.codicon.bootstrap() : previewBootstrap;
        if (disposed) return;
        const nextModels = bootstrap.models.data?.length ? bootstrap.models.data : fallbackModels;
        const nextSettings = {
          ...(bootstrap.settings || fallbackSettings),
          modelSlots: reconcileSlots((bootstrap.settings || fallbackSettings).modelSlots, nextModels),
        };
        setModels(nextModels);
        setSettings(nextSettings);
        setThreads(bootstrap.threads.data || []);
        const account = bootstrap.account.account as { email?: string; type?: string } | undefined;
        setAccountLabel(account?.email || account?.type || "CHATGPT");
        const initialModel = modelForSlot(nextSettings.modelSlots[0], nextModels) || nextModels.find((model) => model.isDefault) || nextModels[0];
        setSelectedEffort(initialModel?.defaultReasoningEffort || "medium");
        setConnection(window.codicon ? "ready" : "preview");
      } catch (loadError) {
        if (disposed) return;
        setSettings(fallbackSettings);
        setModels(fallbackModels);
        setConnection("error");
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    };
    load();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [handleEvent]);

  const ensureThread = useCallback(async (): Promise<string> => {
    if (threadIdRef.current) return threadIdRef.current;
    if (!settings || !selectedModel) throw new Error("モデルとワークスペースを準備中です");
    if (!window.codicon) {
      setThreadId("preview-thread");
      threadIdRef.current = "preview-thread";
      return "preview-thread";
    }
    const result = await window.codicon.startThread({ cwd: settings.workspace, model: selectedModel.model, effort: selectedEffort, serviceTier: selectedServiceTier });
    const thread = result.thread as { id?: string } | undefined;
    if (!thread?.id) throw new Error("Codex スレッドを開始できませんでした");
    setThreadId(thread.id);
    threadIdRef.current = thread.id;
    return thread.id;
  }, [settings, selectedModel, selectedEffort, selectedServiceTier]);

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
        threadId: currentThread,
        activeTurnId: activeTurnRef.current,
        text: trimmed,
        model: selectedModel.model,
        effort: selectedEffort,
        serviceTier: selectedServiceTier,
      });
      const turn = result.turn as { id?: string } | undefined;
      if (turn?.id) setActiveTurnId(turn.id);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    }
  }, [ensureThread, selectedModel, selectedEffort, selectedServiceTier]);

  const chooseWorkspace = useCallback(async () => {
    if (!window.codicon || !settings) return;
    const workspace = await window.codicon.chooseWorkspace();
    if (workspace) setSettings({ ...settings, workspace });
  }, [settings]);

  const saveSettings = useCallback(async (next: CodiconSettings) => {
    const saved = window.codicon ? await window.codicon.saveSettings(next) : next;
    setSettings(saved);
  }, []);

  const selectPower = useCallback(async (slotIndex: number, effort?: string) => {
    if (!settings) return;
    const boundedIndex = Math.max(0, Math.min(settings.modelSlots.length - 1, slotIndex));
    const nextModel = modelForSlot(settings.modelSlots[boundedIndex], models) || models[0];
    const supported = nextModel?.supportedReasoningEfforts.map((option) => option.reasoningEffort) || [];
    const nextEffort = effort && supported.includes(effort) ? effort : supported.includes(selectedEffort) ? selectedEffort : nextModel?.defaultReasoningEffort || supported[0] || "medium";
    const nextServiceTier = selectedServiceTier && nextModel?.serviceTiers.some((tier) => tier.id === selectedServiceTier) ? selectedServiceTier : null;
    setSelectedSlot(boundedIndex);
    setSelectedEffort(nextEffort);
    setSelectedServiceTier(nextServiceTier);
    if (window.codicon && nextModel) {
      try {
        await window.codicon.updatePower({ threadId: threadIdRef.current, model: nextModel.model, effort: nextEffort, serviceTier: nextServiceTier });
      } catch (powerError) {
        setError(powerError instanceof Error ? powerError.message : String(powerError));
      }
    }
  }, [settings, models, selectedEffort, selectedServiceTier]);

  const toggleFast = useCallback(async () => {
    if (!selectedModel) return;
    const fastTier = selectedModel.serviceTiers.find((tier) => tier.name.toLowerCase().includes("fast") || tier.id.toLowerCase() === "fast" || tier.id.toLowerCase() === "priority");
    if (!fastTier) {
      setError(`${selectedModel.displayName} は Fast service tier に対応していません`);
      return;
    }
    const nextTier = selectedServiceTier === fastTier.id ? null : fastTier.id;
    setSelectedServiceTier(nextTier);
    if (window.codicon) {
      try {
        await window.codicon.updatePower({ threadId: threadIdRef.current, model: selectedModel.model, effort: selectedEffort, serviceTier: nextTier });
      } catch (tierError) {
        setError(tierError instanceof Error ? tierError.message : String(tierError));
      }
    }
  }, [selectedModel, selectedServiceTier, selectedEffort]);

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
      const result = await window.codicon.resumeThread(summary.id);
      setThreadId(summary.id);
      threadIdRef.current = summary.id;
      setMessages(historyFromThread(result));
      setError(null);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : String(resumeError));
    }
  }, []);

  const interrupt = useCallback(async () => {
    if (!window.codicon || !threadIdRef.current || !activeTurnRef.current) return;
    try {
      await window.codicon.interrupt({ threadId: threadIdRef.current, turnId: activeTurnRef.current });
    } catch (interruptError) {
      setError(interruptError instanceof Error ? interruptError.message : String(interruptError));
    }
  }, []);

  const respondApproval = useCallback(async (decision: "accept" | "acceptForSession" | "decline" | "cancel") => {
    if (!approval) return;
    if (approval.method === "item/permissions/requestApproval") {
      await window.codicon?.respond({
        id: approval.id,
        result: {
          permissions: decision === "accept" || decision === "acceptForSession" ? approval.permissions || {} : {},
          scope: decision === "acceptForSession" ? "session" : "turn",
        },
      });
    } else {
      await window.codicon?.respond({ id: approval.id, result: { decision } });
    }
    setApproval(null);
  }, [approval]);

  const answerUserInput = useCallback(async (answers: Record<string, string>) => {
    if (!inputRequest) return;
    const responseAnswers = Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, { answers: [answer] }]));
    await window.codicon?.respond({ id: inputRequest.id, result: { answers: responseAnswers } });
    setInputRequest(null);
  }, [inputRequest]);

  const answerUserInputDefaults = useCallback(() => {
    if (!inputRequest) return;
    const answers = Object.fromEntries(inputRequest.questions.map((question) => [question.id, question.options?.[0]?.label || ""]));
    void answerUserInput(answers);
  }, [inputRequest, answerUserInput]);

  const refreshThreads = useCallback(async () => {
    const response = await window.codicon?.listThreads();
    if (response?.data) setThreads(response.data);
  }, []);

  return {
    connection, error, setError, settings, models, threads, threadId, activeTurnId, messages, activity, approval, inputRequest,
    selectedSlot, selectedEffort, selectedServiceTier, selectedModel, liveTranscript, voiceActive, setVoiceActive, setLiveTranscript,
    accountLabel, ensureThread, sendMessage, chooseWorkspace, saveSettings, selectPower, newThread, resumeThread,
    interrupt, respondApproval, answerUserInput, answerUserInputDefaults, toggleFast, refreshThreads,
  };
}
