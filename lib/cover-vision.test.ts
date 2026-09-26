import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * public/cover-vision.js against synthetic photos: a book drawn at an angle
 * on a textured background, with known corners.
 */
const require = createRequire(import.meta.url);
type Corners = number[][];
type Img = { width: number; height: number; data: Uint8ClampedArray };
const vision = require("../public/cover-vision.js") as {
  detect: (cv: unknown, image: Img) => Corners | null;
  flatten: (cv: unknown, image: Img, corners: Corners) => Img;
  orderCorners: (points: Corners) => Corners;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cv: any;

beforeAll(async () => {
  const opencv = require("@techstark/opencv-js");
  // OpenCV.js is "thenable" in a way that makes `await` loop forever: wait
  // for it without ever resolving a promise with the module itself.
  await new Promise<void>((resolve) => {
    if (opencv.Mat) return resolve();
    if (typeof opencv.then === "function") opencv.then(() => resolve());
    else opencv.onRuntimeInitialized = () => resolve();
  });
  cv = opencv;
}, 60_000);

/**
 * A W×H photo: noisy dark background (or wood grain), a pale book at
 * `corners` with dark "text" and, optionally, a dark band across it.
 */
function photo(W: number, H: number, corners: Corners | null, { busy = false, seed = 7, wood = false, band = false } = {}): Img {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const mat = new cv.Mat(H, W, cv.CV_8UC4, new cv.Scalar(70, 60, 55, 255));
  for (let i = 0; i < (busy ? 400 : 60); i++) {
    const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
    const c = 40 + rand() * (busy ? 120 : 40);
    cv.rectangle(mat, new cv.Point(x, y), new cv.Point(x + 3 + rand() * (busy ? 30 : 8), y + 2 + rand() * 6), new cv.Scalar(c, c, c, 255), -1);
  }
  if (wood) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = 70 + 22 * Math.sin(x / 9 + Math.sin(y / 40) * 3) + rand() * 14;
        const i = (y * W + x) * 4;
        mat.data[i] = v + 15;
        mat.data[i + 1] = v;
        mat.data[i + 2] = v - 10;
      }
    }
  }
  if (corners) {
    const pts = corners.map(([x, y]) => [Math.round(x * W), Math.round(y * H)]);
    const poly = cv.matFromArray(4, 1, cv.CV_32SC2, pts.flat());
    const polys = new cv.MatVector();
    polys.push_back(poly);
    cv.fillPoly(mat, polys, new cv.Scalar(225, 215, 190, 255));
    // Title "text": dark blocks inside the cover.
    const [tl, tr, , bl] = pts;
    for (let row = 0; row < 5; row++) {
      const f = 0.2 + row * 0.12;
      const x = tl[0] + (bl[0] - tl[0]) * f + (tr[0] - tl[0]) * 0.2;
      const y = tl[1] + (bl[1] - tl[1]) * f + (tr[1] - tl[1]) * 0.2;
      cv.rectangle(mat, new cv.Point(x, y), new cv.Point(x + (tr[0] - tl[0]) * 0.5, y + 8), new cv.Scalar(40, 30, 30, 255), -1);
    }
    if (band) {
      // A dark band right across the cover, 55–68% of the way down.
      const at = (f: number) => [
        [tl[0] + (bl[0] - tl[0]) * f, tl[1] + (bl[1] - tl[1]) * f],
        [tr[0] + (pts[2][0] - tr[0]) * f, tr[1] + (pts[2][1] - tr[1]) * f],
      ];
      const [a1, b1] = at(0.55);
      const [a2, b2] = at(0.68);
      const bandPoly = cv.matFromArray(4, 1, cv.CV_32SC2, [a1, b1, b2, a2].flat().map(Math.round));
      const bandPolys = new cv.MatVector();
      bandPolys.push_back(bandPoly);
      cv.fillPoly(mat, bandPolys, new cv.Scalar(170, 40, 40, 255));
      bandPoly.delete();
      bandPolys.delete();
    }
    poly.delete();
    polys.delete();
  }
  const out = { width: W, height: H, data: new Uint8ClampedArray(mat.data) };
  mat.delete();
  return out;
}

const near = (a: Corners, b: Corners, tolerance: number) =>
  a.every((p, i) => Math.abs(p[0] - b[i][0]) < tolerance && Math.abs(p[1] - b[i][1]) < tolerance);

describe("cover vision", () => {
  const tilted: Corners = [
    [0.28, 0.14],
    [0.74, 0.2],
    [0.7, 0.86],
    [0.22, 0.8],
  ];

  it("orders corners top-left, top-right, bottom-right, bottom-left", () => {
    expect(vision.orderCorners([[10, 90], [90, 90], [10, 10], [90, 10]])).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]]);
  });

  it("finds a tilted book on a plain background", () => {
    const found = vision.detect(cv, photo(1280, 960, tilted));
    expect(found).not.toBeNull();
    expect(near(found!, tilted, 0.02)).toBe(true);
  });

  it("finds a book in a portrait photo against a busy background", () => {
    const upright: Corners = [[0.2, 0.2], [0.8, 0.22], [0.78, 0.78], [0.22, 0.8]];
    const found = vision.detect(cv, photo(900, 1200, upright, { busy: true }));
    expect(found).not.toBeNull();
    expect(near(found!, upright, 0.03)).toBe(true);
  });

  it("finds the whole of a banded cover on a wood-grain table, not just a piece of it", () => {
    const found = vision.detect(cv, photo(1280, 960, tilted, { wood: true, band: true }));
    expect(found).not.toBeNull();
    expect(near(found!, tilted, 0.02)).toBe(true);
  });

  it("joins a cover cut into pieces by lines the same tone as the table", () => {
    const image = photo(1280, 960, tilted);
    // Two lines right across the cover, in the background's colour.
    const [tl, tr, br, bl] = tilted.map(([x, y]) => [x * 1280, y * 960]);
    const mat = cv.matFromArray(960, 1280, cv.CV_8UC4, Array.from(image.data));
    for (const f of [0.3, 0.6]) {
      const a = [tl[0] + (bl[0] - tl[0]) * f, tl[1] + (bl[1] - tl[1]) * f];
      const b = [tr[0] + (br[0] - tr[0]) * f, tr[1] + (br[1] - tr[1]) * f];
      cv.line(mat, new cv.Point(a[0] - 4, a[1]), new cv.Point(b[0] + 4, b[1]), new cv.Scalar(70, 60, 55, 255), 14);
    }
    const striped = { width: 1280, height: 960, data: new Uint8ClampedArray(mat.data) };
    mat.delete();
    const found = vision.detect(cv, striped);
    expect(found).not.toBeNull();
    expect(near(found!, tilted, 0.025)).toBe(true);
  });

  it("reports nothing when there's no book", () => {
    expect(vision.detect(cv, photo(1280, 960, null))).toBeNull();
  });

  it("flattens to an upright cover of the book's proportions", () => {
    const image = photo(1280, 960, tilted);
    const cover = vision.flatten(cv, image, tilted);
    expect(cover.data.length).toBe(cover.width * cover.height * 4);
    // The tilted book is ~0.46×1280 wide and ~0.66×960 tall.
    expect(cover.height / cover.width).toBeGreaterThan(1.0);
    expect(cover.height / cover.width).toBeLessThan(1.25);
    // Its middle is the pale cover, not the dark background.
    const mid = (Math.floor(cover.height * 0.1) * cover.width + Math.floor(cover.width / 2)) * 4;
    expect(cover.data[mid]).toBeGreaterThan(180);
    expect(cover.data[mid + 3]).toBe(255);
  });

  it("keeps the cover no larger than 1600px on its long side", () => {
    const image = photo(2400, 3200, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const cover = vision.flatten(cv, image, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(Math.max(cover.width, cover.height)).toBe(1600);
  });
});
