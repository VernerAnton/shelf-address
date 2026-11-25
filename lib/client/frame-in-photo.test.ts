import { describe, expect, it } from "vitest";
import { frameInPhoto } from "@/lib/client/bookops";

const round = (r: { x: number; y: number; width: number; height: number } | null) =>
  r && { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };

describe("the dotted frame in the photo", () => {
  it("same shape as the screen: the frame's share of it", () => {
    // 400×600 box showing a 1000×1500 picture exactly; frame 10% in from each side.
    expect(round(frameInPhoto({ width: 400, height: 600 }, { x: 40, y: 60, width: 320, height: 480 }, { width: 1000, height: 1500 }, { width: 2000, height: 3000 }))).toEqual({
      x: 200,
      y: 300,
      width: 1600,
      height: 2400,
    });
  });
  it("the screen cuts the top and bottom off a taller picture (cover): the frame maps to what's shown", () => {
    // 1080×1920 picture in a 400×600 box: scale 0.37, only the middle 1620 px of its height is on screen.
    const r = round(frameInPhoto({ width: 400, height: 600 }, { x: 0, y: 0, width: 400, height: 600 }, { width: 1080, height: 1920 }, { width: 1080, height: 1920 }));
    expect(r).toEqual({ x: 0, y: 150, width: 1080, height: 1620 });
    const tall = round(frameInPhoto({ width: 400, height: 500 }, { x: 0, y: 0, width: 400, height: 500 }, { width: 1080, height: 1920 }, { width: 1080, height: 1920 }));
    expect(tall).toEqual({ x: 0, y: 285, width: 1080, height: 1350 });
  });
  it("a 3:4 photo with a 9:16 live picture: the live picture is its middle", () => {
    // Whole live picture framed; photo 3000×4000 (3:4), live 1080×1920 (9:16): middle 2250 wide.
    expect(round(frameInPhoto({ width: 1080, height: 1920 }, { x: 0, y: 0, width: 1080, height: 1920 }, { width: 1080, height: 1920 }, { width: 3000, height: 4000 }))).toEqual({
      x: 375,
      y: 0,
      width: 2250,
      height: 4000,
    });
  });
  it("a photo turned the other way can't be matched", () => {
    expect(frameInPhoto({ width: 400, height: 600 }, { x: 0, y: 0, width: 400, height: 600 }, { width: 1080, height: 1920 }, { width: 4000, height: 3000 })).toBeNull();
  });
});
