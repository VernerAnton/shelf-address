const { chromium, devices } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
let passed = 0; const failures = [];
const check = (name, cond, extra = "") => { if (cond) passed++; else failures.push(name + (extra ? ` — ${extra}` : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The installed app: the page reports display-mode standalone.
const installed = () => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q) => (q.includes("display-mode: standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q));
};
(async () => {
  const errors = [];
  const browser = await chromium.launch();
  {
    const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://127.0.0.1:8788" });
    await ctx.addInitScript(installed);
    const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(String(e)));
    // An app installed before V14 launches on its old start page.
    await page.goto("/scan");
    await page.waitForURL(/\/evaluate$/, { timeout: 10000 }).catch(() => {});
    check("installed app launched on /scan opens Evaluate", page.url().endsWith("/evaluate"), page.url());
    check("Evaluate shows", await page.getByRole("region", { name: "Evaluate settings" }).waitFor({ timeout: 15000 }).then(() => true, () => false));
    // Scan tab in the same session: stays on Scan.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sections" }).click();
    await page.waitForURL(/\/sections$/);
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Scan" }).click();
    await page.waitForURL(/\/scan$/); await sleep(1500);
    check("Scan tab still opens Scan", page.url().endsWith("/scan"), page.url());
    await page.reload(); await sleep(1500);
    check("reloading Scan stays on Scan", page.url().endsWith("/scan"), page.url());
    await page.goto("/scan"); await sleep(1500);
    check("loading /scan again in the same session stays on Scan", page.url().endsWith("/scan"), page.url());
    // A fresh launch on the new start page.
    const fresh = await ctx.newPage();
    await fresh.goto("/"); await fresh.waitForURL(/\/evaluate$/);
    check("new start page opens Evaluate", fresh.url().endsWith("/evaluate"));
    await ctx.close();
  }
  {
    // A normal browser tab: /scan is just Scan.
    const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://127.0.0.1:8788" });
    const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/scan"); await sleep(2000);
    check("browser tab on /scan stays on Scan", page.url().endsWith("/scan"), page.url());
    await ctx.close();
  }
  await browser.close();
  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} passed, ${failures.length} failed`); failures.forEach((f) => console.log("FAIL: " + f));
})().catch((e) => { console.log("CRASH: " + e.message.split("\n")[0]); console.log(`${passed} passed; ${JSON.stringify(failures)}`); process.exit(1); });
