// Fake camera scenes for Chromium (--use-file-for-fake-video-capture), drawn in
// code and written as Y4M on first use (e2e/.cache, not committed):
//   book     the barcode of EAN 9789510366868 on a book's back
//   notbook  a plain scene with no barcode
//   cover    a book cover lying on a darker table, for the cover camera
const fs = require("fs");
const path = require("path");

const W = 640, H = 480;
const CACHE = path.join(__dirname, ".cache");

const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const P = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

/** The 95 modules of an EAN-13 barcode, as "1"/"0". */
function ean13(code) {
  const d = code.split("").map(Number);
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (P[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + "101";
}

function frame(draw) {
  const y = Buffer.alloc(W * H, 128);
  const u = Buffer.alloc((W / 2) * (H / 2), 128);
  const v = Buffer.alloc((W / 2) * (H / 2), 128);
  const rect = (x0, y0, w, h, luma, cu = 128, cv = 128) => {
    for (let yy = Math.max(0, y0); yy < Math.min(H, y0 + h); yy++) y.fill(luma, yy * W + Math.max(0, x0), yy * W + Math.min(W, x0 + w));
    for (let yy = Math.max(0, y0 >> 1); yy < Math.min(H / 2, (y0 + h) >> 1); yy++) {
      u.fill(cu, yy * (W / 2) + Math.max(0, x0 >> 1), yy * (W / 2) + Math.min(W / 2, (x0 + w) >> 1));
      v.fill(cv, yy * (W / 2) + Math.max(0, x0 >> 1), yy * (W / 2) + Math.min(W / 2, (x0 + w) >> 1));
    }
  };
  draw(rect);
  return Buffer.concat([Buffer.from("FRAME\n"), y, u, v]);
}

const SCENES = {
  book: (rect) => {
    rect(0, 0, W, H, 150, 120, 140); // the cover around it
    rect(110, 120, 420, 240, 235); // white label
    const bits = ean13("9789510366868");
    for (let i = 0; i < 95; i++) if (bits[i] === "1") rect(130 + i * 4, 150, 4, 180, 20);
  },
  notbook: (rect) => {
    rect(0, 0, W, H, 140, 110, 150);
    rect(200, 150, 240, 180, 90, 140, 120);
  },
  cover: (rect) => {
    rect(0, 0, W, H, 55, 110, 140); // dark table
    rect(190, 70, 260, 350, 215, 90, 170); // the cover, a warm colour
    rect(215, 110, 210, 40, 40); // title band
    rect(215, 330, 140, 20, 90); // author line
  },
};

/** Path of the Y4M file for a scene, written if it isn't there yet. */
function videoFile(scene) {
  if (!SCENES[scene]) throw new Error(`No fake camera scene "${scene}"`);
  const file = path.join(CACHE, `${scene}.y4m`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const one = frame(SCENES[scene]);
    const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`);
    fs.writeFileSync(file, Buffer.concat([header, ...Array(10).fill(one)]));
  }
  return file;
}

module.exports = { videoFile, ean13 };
