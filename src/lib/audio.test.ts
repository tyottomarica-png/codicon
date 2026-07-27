import { downsampleToPcm16, pcm16ToBase64 } from "./audio";

describe("voice PCM conversion", () => {
  it("downsamples and clamps to signed 16-bit PCM", () => {
    const input = new Float32Array([1, 1, -1, -1, 2, 2, -2, -2]);
    const output = downsampleToPcm16(input, 48_000, 24_000);
    expect([...output]).toEqual([32767, -32768, 32767, -32768]);
  });

  it("encodes little-endian PCM bytes to base64", () => {
    expect(pcm16ToBase64(new Int16Array([0, 32767, -32768]))).toBe("AAD/fwCA");
  });

  it("upsamples low-rate input using interpolation", () => {
    const output = downsampleToPcm16(new Float32Array([0, 1]), 12_000, 24_000);
    expect(output).toHaveLength(4);
    expect(output[0]).toBe(0);
    expect(output[3]).toBe(32767);
  });
});
