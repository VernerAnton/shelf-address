#!/usr/bin/env node
// The end-to-end suites, several at once (V33.3). Same suites and the same
// set-up per suite as run.sh, but each of N workers has its own app server,
// book-service stand-in and local database, so N suites run side by side.
// The slowest suites start first (times kept in .wrangler/e2e-times.json),
// so the run ends about when the longest one does.
//
//   npx opennextjs-cloudflare build          # after changing the app
//   node e2e/run-fast.cjs                    # every suite, 3 at a time
//   node e2e/run-fast.cjs -j 2 e2e-scan.cjs  # just these, 2 at a time
//
// Worker k: app on 127.0.0.1:(8800+10k), stand-in on (8801+10k), debugger port
// (9300+k), database and files in .wrangler/e2e-w<k>. Everything a worker starts
// is in its own process group and is stopped with it — nothing else is touched,
// so this doesn't knock over a `serve.sh` or a run.sh in progress (but don't
// run two of these at once: they'd share the worker ports).
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TIMES = path.join(ROOT, ".wrangler/e2e-times.json");
const SUITE_TIMEOUT_MS = 20 * 60 * 1000;

const args = process.argv.slice(2);
let jobs = 3;
const named = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-j") jobs = Math.max(1, Number(args[++i]) || 1);
  else named.push(args[i]);
}
const all = fs.readdirSync(__dirname).filter((f) => /^e2e-.*\.cjs$/.test(f)).sort();
const suites = named.length ? named : all;
let times = {};
try {
  times = JSON.parse(fs.readFileSync(TIMES, "utf8"));
} catch {
  // first run: alphabetical
}
// Slowest first; unknown ones (new suites) count as slow.
const queue = [...suites].sort((a, b) => (times[b] ?? 1e9) - (times[a] ?? 1e9));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, cmdArgs, env) =>
  new Promise((resolve, reject) =>
    execFile(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, ...env }, maxBuffer: 64 << 20 }, (e, out) => (e ? reject(e) : resolve(out))),
  );
/** Starts a long-running process in its own group, logging to `log`. */
function start(cmd, cmdArgs, log, env = {}) {
  const out = fs.openSync(log, "w");
  return spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", out, out] });
}
function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", resolve);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      return resolve();
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // gone
      }
    }, 5000);
  });
}
async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
}

const results = [];
let failed = false;

async function worker(k) {
  const port = 8800 + 10 * k;
  const booksPort = port + 1;
  const base = `http://127.0.0.1:${port}`;
  const books = `http://127.0.0.1:${booksPort}`;
  const persist = path.join(ROOT, `.wrangler/e2e-w${k}`);
  const persistArgs = ["--local", "--persist-to", persist];
  for (let suite = queue.shift(); suite; suite = queue.shift()) {
    const started = Date.now();
    fs.rmSync(persist, { recursive: true, force: true });
    let app, stand, line;
    try {
      await run("npx", ["wrangler", "d1", "migrations", "apply", "shelf-address-db", ...persistArgs], { CI: "true" });
      const seed = (/^\/\/ seed: *(\w+)/.exec(fs.readFileSync(path.join(__dirname, suite), "utf8").split("\n")[0]) ?? [])[1] ?? "places";
      const fixture = { places: "places.sql", shelves: "store-shelves.sql" }[seed];
      if (fixture) await run("npx", ["wrangler", "d1", "execute", "DB", ...persistArgs, "--file", `e2e/fixtures/${fixture}`]);
      stand = start("node", ["e2e/mock-books.cjs"], path.join(ROOT, `.wrangler/e2e-w${k}-books.log`), { E2E_BOOKS_PORT: String(booksPort) });
      const vars = {
        FINNA_API_BASE: books,
        FINNA_COVER_BASE: books,
        GOOGLE_BOOKS_API_BASE: books,
        OPEN_LIBRARY_BASE: books,
        OPEN_LIBRARY_COVERS_BASE: books,
        OPENROUTER_BASE: `${books}/api/v1`,
        OPENROUTER_API_KEY: "test-openrouter-key",
        EXTRACT_CODE: "test-code",
      };
      app = start(
        "npx",
        ["wrangler", "dev", "--port", String(port), "--inspector-port", String(9300 + k), ...persistArgs, ...Object.entries(vars).flatMap(([n, v]) => ["--var", `${n}:${v}`])],
        path.join(ROOT, `.wrangler/e2e-w${k}-wrangler.log`),
      );
      if (!(await waitFor(`${base}/api/version`, 120_000))) throw new Error(`the app didn't start (see .wrangler/e2e-w${k}-wrangler.log)`);
      const output = await new Promise((resolve) => {
        const child = spawn("node", [`e2e/${suite}`], {
          cwd: ROOT,
          env: { ...process.env, E2E_BASE: base, E2E_BOOKS: books, E2E_PERSIST: persist },
          detached: true,
        });
        let text = "";
        child.stdout.on("data", (d) => (text += d));
        child.stderr.on("data", (d) => (text += d));
        const timer = setTimeout(() => stop(child), SUITE_TIMEOUT_MS);
        child.on("exit", () => {
          clearTimeout(timer);
          resolve(text);
        });
      });
      line = output.trim().split("\n").slice(-12).join(" ");
    } catch (e) {
      line = `CRASH: ${String(e.message).split("\n")[0]}`;
    } finally {
      await Promise.all([stop(app), stop(stand)]);
    }
    const secs = Math.round((Date.now() - started) / 1000);
    times[suite] = secs;
    if (!/ 0 failed/.test(line) || /CRASH/.test(line)) failed = true;
    results.push({ suite, line, secs });
    console.log(`== ${suite}: ${line}  (${secs} s)`);
  }
  fs.rmSync(persist, { recursive: true, force: true });
}

(async () => {
  const t0 = Date.now();
  fs.mkdirSync(path.join(ROOT, ".wrangler"), { recursive: true });
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, (_, k) => worker(k)));
  fs.writeFileSync(TIMES, JSON.stringify(times, null, 1));
  const total = results.reduce((n, r) => n + Number((/(\d+) passed/.exec(r.line) ?? [0, 0])[1]), 0);
  console.log(`-- ${results.length} suites, ${total} checks passed, ${failed ? "SOME FAILED" : "all passed"}, in ${Math.round((Date.now() - t0) / 60000)} min`);
  process.exit(failed ? 1 : 0);
})();
