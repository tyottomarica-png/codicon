import { act, renderHook, waitFor } from "@testing-library/react";
import { useCodexSession } from "./useCodexSession";

describe("Codex session power controls", () => {
  it("toggles the catalog-provided Fast service tier", async () => {
    const { result } = renderHook(() => useCodexSession());
    await waitFor(() => expect(result.current.connection).toBe("preview"));
    expect(result.current.selectedServiceTier).toBeNull();
    await act(async () => result.current.toggleFast());
    expect(result.current.selectedServiceTier).toBe("priority");
    await act(async () => result.current.toggleFast());
    expect(result.current.selectedServiceTier).toBeNull();
  });
});
