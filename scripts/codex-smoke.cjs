const { spawn } = require("node:child_process");
const readline = require("node:readline");

const binary = process.env.CODEX_PATH || "codex";
const proc = spawn(binary, ["app-server", "--stdio", "--enable", "realtime_conversation"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const pending = new Map();
let requestId = 1;

function send(message) {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params = {}) {
  const id = requestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 20_000);
    pending.set(id, { resolve, reject, timer });
    send({ method, id, params });
  });
}

readline.createInterface({ input: proc.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "currentTime/read" && message.id !== undefined) {
    send({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } });
    return;
  }
  if (message.id === undefined || message.method) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
  else entry.resolve(message.result);
});

proc.once("error", (error) => {
  console.error(`Could not start ${binary}: ${error.message}`);
  process.exitCode = 1;
});

(async () => {
  try {
    const initialized = await request("initialize", {
      clientInfo: { name: "codicon_smoke", title: "Codicon protocol smoke test", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    send({ method: "initialized" });
    const [models, account, config] = await Promise.all([
      request("model/list", { includeHidden: false, limit: 100 }),
      request("account/read", { refreshToken: false }),
      request("config/read", { includeLayers: false }),
    ]);
    let realtimeVoice = "not tested";
    if (process.env.CODEX_SMOKE_VOICE === "1") {
      const voiceModel = models?.data?.find((model) => model.isDefault) || models?.data?.[0];
      const startedThread = await request("thread/start", {
        model: voiceModel?.model || null,
        cwd: process.cwd(),
        approvalPolicy: "on-request",
        sandbox: "read-only",
        ephemeral: true,
      });
      const fastTier = voiceModel?.serviceTiers?.find((tier) => tier.name?.toLowerCase().includes("fast")) || voiceModel?.serviceTiers?.[0];
      if (fastTier) {
        await request("thread/settings/update", {
          threadId: startedThread.thread.id,
          model: voiceModel.model,
          effort: voiceModel.defaultReasoningEffort,
          serviceTier: fastTier.id,
        });
      }
      await request("thread/realtime/start", {
        threadId: startedThread.thread.id,
        outputModality: "text",
        includeStartupContext: true,
        flushTranscriptTailOnSessionEnd: true,
        version: "v1",
      });
      const silentSamples = 2_400;
      await request("thread/realtime/appendAudio", {
        threadId: startedThread.thread.id,
        audio: {
          data: Buffer.alloc(silentSamples * 2).toString("base64"),
          sampleRate: 24_000,
          numChannels: 1,
          samplesPerChannel: silentSamples,
          itemId: null,
        },
      });
      await request("thread/realtime/stop", { threadId: startedThread.thread.id });
      realtimeVoice = `connected, accepted PCM16 audio, and stopped; service tier ${fastTier?.id || "none"} accepted`;
    }
    const summary = {
      server: initialized,
      accountType: account?.account?.type || account?.account?.email || "signed-out",
      configuredModel: config?.config?.model || null,
      realtimeVoice,
      models: (models?.data || []).map((model) => ({
        model: model.model,
        displayName: model.displayName,
        efforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
        serviceTiers: model.serviceTiers.map((tier) => tier.id),
        isDefault: model.isDefault,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    proc.kill("SIGTERM");
  }
})();
