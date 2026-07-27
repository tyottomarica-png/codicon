import type { AudioChunk } from "../types/codicon";

const TARGET_SAMPLE_RATE = 24_000;

export function downsampleToPcm16(input: Float32Array, sourceRate: number, targetRate = TARGET_SAMPLE_RATE): Int16Array {
  if (targetRate > sourceRate) {
    const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
    const output = new Int16Array(outputLength);
    const scale = outputLength > 1 ? (input.length - 1) / (outputLength - 1) : 0;
    for (let index = 0; index < outputLength; index += 1) {
      const position = index * scale;
      const before = Math.floor(position);
      const after = Math.min(input.length - 1, before + 1);
      const sample = Math.max(-1, Math.min(1, input[before] + (input[after] - input[before]) * (position - before)));
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  }
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.max(start + 1, Math.min(input.length, Math.floor((outputIndex + 1) * ratio)));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) sum += input[inputIndex];
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const blockSize = 0x8000;
  for (let index = 0; index < bytes.length; index += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + blockSize));
  }
  return btoa(binary);
}

export class PushToTalkCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private queue = Promise.resolve();
  private queueError: unknown = null;

  constructor(private readonly onChunk: (chunk: AudioChunk) => Promise<unknown>) {}

  async start(): Promise<void> {
    if (this.context) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextCtor({ latencyHint: "interactive" });
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.silentGain = this.context.createGain();
    this.silentGain.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      if (!this.context) return;
      const pcm = downsampleToPcm16(event.inputBuffer.getChannelData(0), this.context.sampleRate);
      const chunk: AudioChunk = {
        data: pcm16ToBase64(pcm),
        sampleRate: TARGET_SAMPLE_RATE,
        numChannels: 1,
        samplesPerChannel: pcm.length,
        itemId: null,
      };
      this.queue = this.queue.then(() => this.onChunk(chunk)).then(() => undefined).catch((error) => {
        this.queueError ||= error;
      });
    };
    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.context.destination);
  }

  async stop(): Promise<void> {
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.silentGain?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.context = null;
    this.stream = null;
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    await this.queue;
    if (this.queueError) {
      const error = this.queueError;
      this.queueError = null;
      throw error;
    }
  }
}
