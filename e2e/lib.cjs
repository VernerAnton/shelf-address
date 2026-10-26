// Shared helpers for the end-to-end suites (run with e2e/run.sh).
const { execSync } = require("child_process");
const path = require("path");
const { chromium, devices } = require(execSync("npm root -g").toString().trim() + "/playwright");
const { videoFile } = require("./videos.cjs");

const ROOT = path.join(__dirname, "..");
const BASE_URL = "http://127.0.0.1:8788";
const BOOKS = "http://127.0.0.1:8790"; // the book-service stand-in (mock-books.cjs)
const APP_VERSION = Number(/APP_VERSION = (\d+)/.exec(require("fs").readFileSync(path.join(ROOT, "lib/version.ts"), "utf8"))[1]);

/** Pass/fail bookkeeping; `done()` prints the result line run.sh shows. */
function suite() {
  let crashWith;
  let passed = 0;
  const failures = [];
  const errors = [];
  const t = {
    errors,
    check(name, cond, extra = "") {
      if (cond) passed++;
      else failures.push(name + (extra ? ` — ${extra}` : ""));
    },
    done() {
      if (errors.length) failures.push("page errors: " + errors.join(" | "));
      console.log(`${passed} passed, ${failures.length} failed`);
      failures.forEach((f) => console.log("FAIL: " + f));
    },
    crash: (e) => crashWith(e),
    _crash(e) {
      const lines = String(e && e.message).split("\n");
      const step = String(e && e.stack).split("\n").find((l) => /e2e\/e2e-/.test(l)) || "";
      console.log("CRASH: " + lines[0] + " " + (lines.find((l) => /waiting for|locator/.test(l)) || "") + " " + step.trim());
      console.log(`${passed} passed; ${JSON.stringify(failures)}`);
      process.exit(1);
    },
  };
  crashWith = (e) => t._crash(e);
  return t;
}

/** Runs SQL on the local database (the one wrangler dev serves). */
function sql(q) {
  const out = execSync(`npx wrangler d1 execute shelf-address-db --local --json --command ${JSON.stringify(q)}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out.toString())[0].results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (loc, t = 15000) => loc.first().waitFor({ state: "visible", timeout: t }).then(() => true, () => false);
const gone = (loc, t = 15000) => loc.first().waitFor({ state: "detached", timeout: t }).then(() => true, () => false);

/** Chromium with a fake camera showing one of videos.cjs's scenes ("book", "notbook", "cover"), or the default test pattern. */
async function browser(scene) {
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
  if (scene) args.push(`--use-file-for-fake-video-capture=${videoFile(scene)}`);
  return chromium.launch({ args });
}

/** A phone-sized page, camera allowed, page errors collected into `t.errors`. */
async function phone(b, t, options = {}) {
  const ctx = await b.newContext({ ...devices["Pixel 7"], baseURL: BASE_URL, permissions: ["camera"], ...options });
  // Nothing reaches the real Antikvaari.
  await ctx.route("https://www.antikvaari.fi/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>Antikvaari stand-in</title><h1>Antikvaari stand-in</h1>" }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => t.errors.push(String(e)));
  return page;
}

/** Scan tab: choose the active place through the picker ("Store", "Wall unit", "Row 2"). */
async function choosePlace(page, ...names) {
  await page.getByRole("button", { name: /^(Choose|Change)$/ }).click();
  await page.getByRole("button", { name: "All places" }).click();
  for (const n of names) await page.getByRole("dialog").getByRole("button", { name: new RegExp(n) }).first().click();
  const logHere = page.getByRole("button", { name: /^Log books at/ });
  if (await logHere.isVisible().catch(() => false)) await logHere.click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}

/** Saves a value in the app's on-phone store (IndexedDB "shelf-address"/"kv") before a screen reads it. */
const kvPut = (page, key, value) =>
  page.evaluate(([key, value]) => new Promise((resolve, reject) => {
    const r = indexedDB.open("shelf-address", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(value, key); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    r.onerror = () => reject(r.error);
  }), [key, value]);

const kvGet = (page, key) =>
  page.evaluate((key) => new Promise((resolve) => {
    const r = indexedDB.open("shelf-address", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => { const q = r.result.transaction("kv").objectStore("kv").get(key); q.onsuccess = () => { r.result.close(); resolve(q.result); }; };
  }), key);

/** Tells the book-service stand-in to fail (or recover) for an ISBN. */
const booksDown = (isbn, down = true) => fetch(`${BOOKS}/__down?isbn=${isbn}&down=${down ? 1 : 0}`, { method: "POST" });

module.exports = { ROOT, BASE_URL, BOOKS, APP_VERSION, suite, sql, sleep, visible, gone, browser, phone, choosePlace, kvPut, kvGet, booksDown, chromium, devices };
