import { describe, expect, it } from "vitest";
import { backCameras, pickMainCamera, zoomSteps } from "@/lib/camera-choice";

describe("choosing the camera", () => {
  it("Samsung-style labels: the main back lens is camera2 0, not the macro or ultra-wide", () => {
    const devices = [
      { deviceId: "front", label: "camera2 1, facing front" },
      { deviceId: "macro", label: "camera2 3, facing back" },
      { deviceId: "main", label: "camera2 0, facing back" },
      { deviceId: "wide", label: "camera2 2, facing back" },
    ];
    expect(pickMainCamera(devices)).toBe("main");
    expect(backCameras(devices).map((d) => d.deviceId)).toEqual(["main", "wide", "macro"]);
  });

  it("iPhone-style labels: Back Camera before ultra-wide and telephoto", () => {
    const devices = [
      { deviceId: "uw", label: "Back Ultra Wide Camera" },
      { deviceId: "tele", label: "Back Telephoto Camera" },
      { deviceId: "main", label: "Back Camera" },
      { deviceId: "front", label: "Front Camera" },
    ];
    expect(pickMainCamera(devices)).toBe("main");
    expect(backCameras(devices)).toHaveLength(3);
  });

  it("no labels yet (camera not allowed): no choice, use 'environment'", () => {
    expect(pickMainCamera([{ deviceId: "a", label: "" }, { deviceId: "b", label: "" }])).toBeNull();
  });

  it("only a front camera (a laptop): no back camera to pick", () => {
    expect(pickMainCamera([{ deviceId: "f", label: "FaceTime HD Camera (front)" }])).toBeNull();
  });

  it("zoom steps stay within what the camera allows", () => {
    expect(zoomSteps({ min: 1, max: 8 })).toEqual([1, 2, 3]);
    expect(zoomSteps({ min: 1, max: 2.5 })).toEqual([1, 2]);
    expect(zoomSteps({ min: 1, max: 1 })).toEqual([]);
    expect(zoomSteps(null)).toEqual([]);
  });
});
