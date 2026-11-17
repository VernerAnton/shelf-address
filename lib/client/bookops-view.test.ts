import { describe, expect, it } from "vitest";
import { viewRect } from "@/lib/client/bookops";

describe("BookOps camera view", () => {
  it("upright: a 3:4 portrait from the middle of a wide webcam picture", () => {
    expect(viewRect(1920, 1080, { shape: "upright", zoom: 1, turn: 0 })).toMatchObject({ x: 555, y: 0, width: 810, height: 1080 });
  });
  it("zoomed in: smaller, still centred", () => {
    expect(viewRect(1920, 1080, { shape: "upright", zoom: 2, turn: 0 })).toMatchObject({ x: 757.5, y: 270, width: 405, height: 540 });
  });
  it("turned (webcam on its side): the portrait uses the camera's full width", () => {
    const r = viewRect(1920, 1080, { shape: "upright", zoom: 1, turn: 90 });
    expect(r).toMatchObject({ turnedWidth: 1080, turnedHeight: 1920, width: 1080, height: 1440, x: 0, y: 240 });
  });
  it("whole: all of it, or the middle when zoomed", () => {
    expect(viewRect(1920, 1080, { shape: "whole", zoom: 1, turn: 0 })).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(viewRect(1920, 1080, { shape: "whole", zoom: 2, turn: 180 })).toMatchObject({ x: 480, y: 270, width: 960, height: 540 });
  });
});
