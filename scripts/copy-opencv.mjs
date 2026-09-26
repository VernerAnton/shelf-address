// Copies OpenCV.js (the cover camera's edge detection) from node_modules into
// public/vendor, under a name carrying its version so it can be cached for
// good: the service worker and browser never re-download the ~11 MB file
// until the version changes. Runs on install and before every build; the
// copy is not committed (see .gitignore).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const pkg = join(root, "node_modules", "@techstark", "opencv-js");
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const name = `opencv-${version.split("-")[0]}.js`;

// Must match OPENCV_FILE in lib/client/opencv-file.ts.
const expected = readFileSync(join(root, "lib", "client", "opencv-file.ts"), "utf8").match(/"(opencv-[\d.]+\.js)"/)?.[1];
if (expected !== name) {
  console.error(`copy-opencv: installed ${name} but lib/client/opencv-file.ts expects ${expected}. Update one of them.`);
  process.exit(1);
}

const dir = join(root, "public", "vendor");
mkdirSync(dir, { recursive: true });
const target = join(dir, name);
const source = join(pkg, "dist", "opencv.js");
if (!existsSync(target) || statSync(target).size !== statSync(source).size) copyFileSync(source, target);
for (const file of readdirSync(dir)) {
  if (file.startsWith("opencv-") && file !== name) rmSync(join(dir, file));
}
