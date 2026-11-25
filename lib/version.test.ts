import { describe, expect, it } from "vitest";
import { isNewerVersion } from "@/lib/version";

describe("comparing app versions", () => {
  it("small updates (.1) and big ones (whole numbers)", () => {
    expect(isNewerVersion("32.1", "32")).toBe(true);
    expect(isNewerVersion("33", "32.4")).toBe(true);
    expect(isNewerVersion("32", "32.1")).toBe(false);
    expect(isNewerVersion("32.1", "32.1")).toBe(false);
  });
  it("32.10 is newer than 32.9", () => {
    expect(isNewerVersion("32.10", "32.9")).toBe(true);
  });
  it("old numeric versions still compare", () => {
    expect(isNewerVersion(32, "31.5")).toBe(true);
    expect(isNewerVersion("32.1", 32)).toBe(true);
  });
});
