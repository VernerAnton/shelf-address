// Copies the browser libraries the app serves itself into public/vendor,
// under names carrying their versions so they can be cached for good: the
// service worker and browser never re-download them until a version changes.
// Runs on install and before every build; the copies are not committed.
//
//   OpenCV.js  — cover camera edge detection (§15), one ~11 MB file
//   Tesseract  — reading a printed ISBN from a photo (§19): its worker, its
//                engine (the phone picks the variant it can run) and the
//                English text data (enough for digits and "ISBN")
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const modules = join(root, "node_modules");
const vendor = join(root, "public", "vendor");
const version = (pkg) => JSON.parse(readFileSync(join(modules, pkg, "package.json"), "utf8")).version.split("-")[0];

function copy(source, target) {
  mkdirSync(join(target, ".."), { recursive: true });
  if (!existsSync(target) || statSync(target).size !== statSync(source).size) copyFileSync(source, target);
}

/** Must match the names the app asks for (lib/client/vendor-files.ts). */
function expect(name) {
  const declared = readFileSync(join(root, "lib", "client", "vendor-files.ts"), "utf8");
  if (!declared.includes(`"${name}"`)) {
    console.error(`copy-vendor: installed ${name} but lib/client/vendor-files.ts doesn't name it. Update one of them.`);
    process.exit(1);
  }
}

mkdirSync(vendor, { recursive: true });

const opencv = `opencv-${version("@techstark/opencv-js")}.js`;
expect(opencv);
copy(join(modules, "@techstark/opencv-js", "dist", "opencv.js"), join(vendor, opencv));

const tesseract = `tesseract-${version("tesseract.js")}`;
expect(tesseract);
const tdir = join(vendor, tesseract);
copy(join(modules, "tesseract.js", "dist", "worker.min.js"), join(tdir, "worker.min.js"));
for (const file of readdirSync(join(modules, "tesseract.js-core"))) {
  if (/^tesseract-core.*lstm\.wasm\.js$/.test(file)) copy(join(modules, "tesseract.js-core", file), join(tdir, file));
}
copy(join(modules, "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"), join(tdir, "lang", "eng.traineddata.gz"));

// Old versions out.
for (const entry of readdirSync(vendor)) {
  if (entry !== opencv && entry !== tesseract) rmSync(join(vendor, entry), { recursive: true, force: true });
}
