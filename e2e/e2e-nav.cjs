// The bottom rows (docs/spec-corrections.md §22): Sections · Evaluate · Extract,
// and Places · Scan · Catalog above them while in Sections.
const { chromium, devices } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
let passed = 0; const failures = [];
const check = (name, cond, extra = "") => { if (cond) passed++; else failures.push(name + (extra ? ` — ${extra}` : "")); };
const visible = (loc, t = 15000) => loc.first().waitFor({ state: "visible", timeout: t }).then(() => true, () => false);

(async () => {
  const errors = [];
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://127.0.0.1:8788", permissions: ["camera"] });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(String(e)));
  const main = page.getByRole("navigation", { name: "Main" });
  const sub = page.getByRole("navigation", { name: "Sections" });
  const labels = (nav) => nav.getByRole("link").allInnerTexts().then((t) => t.map((x) => x.trim()).join(","));
  const current = (nav) => nav.locator("[aria-current=page]").allInnerTexts().then((t) => t.map((x) => x.trim()).join(","));

  // The version stamp is the last thing on every page: it must not hide behind the rows.
  // Measured on the page's layout (not the screen), so content that grows late can't fool it.
  const clearOfRows = async () => {
    await page.waitForTimeout(1500);
    return page.evaluate(() => {
      const stamp = [...document.querySelectorAll("p, span, div")].reverse().find((el) => /^V\d+$/.test(el.textContent.trim()));
      const rows = document.querySelector("nav[aria-label=Main]").parentElement.getBoundingClientRect();
      if (!stamp) return false;
      const stampBottom = stamp.getBoundingClientRect().bottom + scrollY;
      return stampBottom <= document.documentElement.scrollHeight - rows.height + 1;
    });
  };

  await page.goto("/");
  await page.waitForURL(/\/evaluate$/);
  await visible(page.getByRole("region", { name: "Evaluate settings" }));
  check("main row: Sections, Evaluate, Extract", (await labels(main)) === "Sections,Evaluate,Extract", await labels(main));
  check("on Evaluate: Evaluate marked", (await current(main)) === "Evaluate");
  check("on Evaluate: no Sections row", (await sub.count()) === 0);
  check("Evaluate's end clear of the rows", await clearOfRows());

  await main.getByRole("link", { name: "Extract" }).click();
  await page.waitForURL(/\/extract$/);
  check("Extract opens", await visible(page.getByRole("heading", { name: "Extract" })));
  check("on Extract: Extract marked, no Sections row", (await current(main)) === "Extract" && (await sub.count()) === 0);

  await main.getByRole("link", { name: "Sections" }).click();
  await page.waitForURL(/\/sections$/);
  check("Sections row appears: Places, Scan, Catalog", (await labels(sub)) === "Places,Scan,Catalog", await labels(sub).catch(() => ""));
  check("on Places: Sections + Places marked", (await current(main)) === "Sections" && (await current(sub)) === "Places");
  check("Sections row sits just above the main row", await page.evaluate(() => {
    const s = document.querySelector("nav[aria-label=Sections]").getBoundingClientRect();
    const m = document.querySelector("nav[aria-label=Main]").getBoundingClientRect();
    return s.bottom <= m.top + 1 && m.top - s.bottom < 4 && s.height >= 44;
  }));
  check("Places' end clear of both rows", await clearOfRows());

  await sub.getByRole("link", { name: "Scan" }).click();
  await page.waitForURL(/\/scan$/);
  check("Scan opens from the Sections row", await visible(page.getByRole("heading", { name: "Scan" })));
  check("on Scan: Sections + Scan marked", (await current(main)) === "Sections" && (await current(sub)) === "Scan");
  check("Scan's end clear of both rows", await clearOfRows());

  await sub.getByRole("link", { name: "Catalog" }).click();
  await page.waitForURL(/\/catalog$/);
  check("Catalog opens from the Sections row", await visible(page.getByRole("heading", { name: "Catalog" })));
  check("on Catalog: Sections + Catalog marked", (await current(main)) === "Sections" && (await current(sub)) === "Catalog");

  await page.goto("/sections/r2");
  check("inside a place: still Sections + Places", (await current(main)) === "Sections" && (await current(sub)) === "Places");
  await page.getByRole("button", { name: "Scan books here" }).click();
  await page.waitForURL(/\/scan$/);
  check("'Scan books here' still goes to Scan", (await current(sub)) === "Scan");

  await page.goto("/photo-log");
  check("Photo log counts as Evaluate", (await current(main)) === "Evaluate" && (await sub.count()) === 0);

  await browser.close();
  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} passed, ${failures.length} failed`); failures.forEach((f) => console.log("FAIL: " + f));
})().catch((e) => { console.log("CRASH: " + e.message.split("\n")[0]); console.log(`${passed} passed; ${JSON.stringify(failures)}`); process.exit(1); });
