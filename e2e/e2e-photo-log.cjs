const { chromium, devices } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
let passed = 0; const failures = [];
const check = (name, cond, extra = "") => { if (cond) passed++; else failures.push(name + (extra ? ` — ${extra}` : "")); };
// The version the app should report (lib/version.ts).
const APP_VERSION = Number(/APP_VERSION = (\d+)/.exec(require("fs").readFileSync(__dirname + "/../lib/version.ts", "utf8"))[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (loc, t = 15000) => loc.first().waitFor({ state: "visible", timeout: t }).then(() => true, () => false);

// Evaluate's switches saved before it opens: no auto-open, so the test stays in the app.
const preset = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const r = indexedDB.open("shelf-address", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put({ autoOpen: false, autoResume: true }, "evaluate:settings"); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  r.onerror = () => reject(r.error);
}));
const pendingCount = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open("shelf-address", 1);
  r.onsuccess = () => { const q = r.result.transaction("kv").objectStore("kv").get("photo-log:pending"); q.onsuccess = () => { resolve((q.result || []).length); r.result.close(); }; };
}));

const barcodePhoto = (page) => page.evaluate(() => {
  const code = "9789510230763";
  const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
  const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
  const P = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
  const d = code.split("").map(Number);
  let bits = "101"; for (let i = 1; i <= 6; i++) bits += (P[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bits += "01010"; for (let i = 7; i <= 12; i++) bits += R[d[i]]; bits += "101";
  const c = document.createElement("canvas"); c.width = 1600; c.height = 1200;
  const x = c.getContext("2d"); x.fillStyle = "#f4f1e8"; x.fillRect(0, 0, 1600, 1200); x.fillStyle = "#111";
  for (let i = 0; i < 95; i++) if (bits[i] === "1") x.fillRect(200 + i * 12, 300, 12, 600);
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
});
const pagePhoto = (page, lines) => page.evaluate((lines) => {
  const c = document.createElement("canvas"); c.width = 2400; c.height = 3200;
  const x = c.getContext("2d"); x.fillStyle = "#5a4a3a"; x.fillRect(0, 0, 2400, 3200);
  x.fillStyle = "#f6f2e6"; x.fillRect(300, 400, 1800, 2400);
  x.fillStyle = "#222"; x.font = "48px Georgia, serif";
  lines.forEach((l, i) => x.fillText(l, 400, 700 + i * 90));
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, lines);
const ONE = ["Suomentanut Juhani Lindholm", "© 2004 Otava", "", "ISBN 978-951-0-23076-3", "", "Painettu EU:ssa"];
const TWO = ["Otava 2010", "ISBN 978-951-0-23076-3 (sid.)", "ISBN 978-951-0-36686-8 (nid.)"];

(async () => {
  const errors = [];
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://127.0.0.1:8788", permissions: ["camera"] });
  await ctx.route("https://www.antikvaari.fi/**", (r) => r.fulfill({ contentType: "text/html", body: "<h1>stand-in</h1>" }));
  // Keep hold of the text reader's workers, to kill one later.
  await ctx.addInitScript(() => {
    const Real = window.Worker; window.__workers = [];
    window.Worker = function (url, opts) { const w = new Real(url, opts); if (String(url).includes("tesseract")) window.__workers.push(w); return w; };
    window.Worker.prototype = Real.prototype;
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(String(e)));
  const api = async () => (await (await page.request.get("/api/photo-log")).json()).entries;
  const take = async (name, b64) => page.getByLabel("Barcode photo").setInputFiles({ name, mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") });
  const waitEntries = async (n, t = 90000) => { for (let i = 0; i < t / 1000; i++) { const e = await api(); if (e.length >= n) return e; await sleep(1000); } return api(); };

  await page.goto("/scan"); await preset(page);
  await page.goto("/evaluate");
  check("Photo log linked from Evaluate", await visible(page.getByRole("link", { name: /Photo log/ })));

  // 1. Barcode photo.
  await take("a.jpg", await barcodePhoto(page));
  check("barcode photo works as before", await visible(page.getByRole("region", { name: "Scanned book" }).getByText("978-951023076-3"), 30000));
  let entries = await waitEntries(1);
  const bc = entries[0];
  check("barcode photo logged", entries.length === 1 && bc.outcome === "barcode" && bc.isbns[0] === "9789510230763", JSON.stringify(bc));
  check("…with size, screen, version, phone, timing", bc.width === 1600 && bc.height === 1200 && bc.screen === "/evaluate" && bc.appVersion === APP_VERSION && /Android/.test(bc.userAgent) && bc.durationMs > 0 && bc.bytes > 0, JSON.stringify(bc));
  check("…and photo + thumbnail stored", bc.hasPhoto && bc.hasThumb);
  const full = await page.request.get(`/api/photo-log/${bc.id}/photo`);
  check("full photo served as stored", full.status() === 200 && (await full.body()).length === bc.bytes && full.headers()["content-type"] === "image/jpeg");
  await page.getByRole("button", { name: "Scan next" }).click();

  // 2. Copyright page, one ISBN.
  await take("b.jpg", await pagePhoto(page, ONE));
  check("ISBN page read", await visible(page.getByRole("region", { name: "Scanned book" }), 90000));
  entries = await waitEntries(2);
  check("ISBN page logged with the text read", entries[0].outcome === "isbn" && /ISBN/.test(entries[0].ocrText) && /upright/.test(entries[0].ocrText), JSON.stringify(entries[0]).slice(0, 300));
  await page.getByRole("button", { name: "Scan next" }).click();

  // 3. Dead text reader (as if the phone killed it): the next photo still works.
  await page.evaluate(() => window.__workers.forEach((w) => w.terminate()));
  await take("c.jpg", await pagePhoto(page, ONE));
  check("after the reader dies, the next photo still reads (restarted)", await visible(page.getByRole("region", { name: "Scanned book" }), 150000));
  entries = await waitEntries(3);
  check("…logged as read, having waited out the dead reader", entries[0].outcome === "isbn" && entries[0].durationMs >= 60000, `${entries[0].outcome} ${entries[0].durationMs}`);
  await page.getByRole("button", { name: "Scan next" }).click();

  // 4. Several ISBNs, and nothing.
  await take("d.jpg", await pagePhoto(page, TWO));
  check("several: asks", await visible(page.getByRole("region", { name: "ISBNs in the photo" }), 90000));
  await page.getByRole("button", { name: "None of these" }).click();
  const blank = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 600; const x = c.getContext("2d"); x.fillStyle = "#888"; x.fillRect(0, 0, 800, 600); return c.toDataURL("image/jpeg").split(",")[1]; });
  await take("e.jpg", blank);
  check("nothing found: explained", await visible(page.getByText(/Couldn't find a barcode or an ISBN/), 90000));
  entries = await waitEntries(5);
  check("several and nothing logged", entries[1].outcome === "several" && entries[1].isbns.length === 2 && entries[0].outcome === "none", entries.map((e) => e.outcome).join());

  // 5. No signal: kept on the phone, uploaded when back.
  await page.context().setOffline(true);
  await take("f.jpg", blank);
  await visible(page.getByText(/Couldn't find a barcode or an ISBN/), 90000);
  await sleep(1500);
  check("offline: waits on the phone", (await pendingCount(page)) === 1 && (await api().catch(() => entries)).length === 5);
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  entries = await waitEntries(6, 20000);
  // The phone crosses it off its list just after the server has it.
  let left = await pendingCount(page);
  for (let i = 0; i < 20 && left; i++) { await sleep(250); left = await pendingCount(page); }
  check("back online: uploaded", entries.length === 6 && left === 0, `${entries.length} on the server, ${left} waiting`);

  // 6. The page.
  await page.goto("/photo-log");
  check("page lists them", (await page.getByRole("list", { name: "Photos" }).locator("li").count()) === 6);
  check("summary by outcome", await visible(page.getByText(/6 photos: 1 barcode read, 2 isbn read, 1 several isbns, asked which, 2 nothing found/)));
  const thumbOk = await page.locator("img[alt=Photo]").first().evaluate((img) => img.complete ? img.naturalWidth : new Promise((r) => { img.onload = () => r(img.naturalWidth); img.onerror = () => r(0); }));
  check("thumbnails show", thumbOk > 0 && thumbOk <= 480, String(thumbOk));
  await page.getByText("Text the reader saw").first().click();
  check("text the reader saw, shown", await visible(page.getByText(/— upright —/).first()));
  // Delete one: entry and its files go.
  const target = (await api())[0];
  await page.getByRole("list", { name: "Photos" }).locator("li").first().getByRole("button", { name: "Delete" }).click();
  await sleep(2000);
  check("delete removes the entry", (await api()).length === 5 && (await page.getByRole("list", { name: "Photos" }).locator("li").count()) === 5);
  check("…and its photo", (await page.request.get(`/api/photo-log/${target.id}/photo`)).status() === 404);
  check("cross-site style request without the header refused", (await page.request.post("/api/photo-log", { multipart: { meta: "{}" } })).status() === 400);

  // 7. Switched off: nothing kept.
  const sw = page.getByRole("switch", { name: "Keep photos from this phone" });
  await page.waitForFunction(() => !document.querySelector('[role=switch]').disabled);
  await sw.uncheck();
  check("switch off remembered", await page.evaluate(() => localStorage.getItem("photo-log")) === "off");
  await page.goto("/evaluate");
  await take("g.jpg", blank);
  await visible(page.getByText(/Couldn't find a barcode or an ISBN/), 90000);
  await sleep(3000);
  check("switched off: not logged", (await api()).length === 5);
  await page.goto("/photo-log");
  await page.waitForFunction(() => !document.querySelector('[role=switch]').disabled);
  await page.getByRole("switch", { name: "Keep photos from this phone" }).check();
  check("switch back on", await page.evaluate(() => localStorage.getItem("photo-log")) === null);

  // 8. A photo lost because the phone closed the app while its camera was open.
  await page.goto("/evaluate");
  await visible(page.getByRole("button", { name: "Stop camera" }));
  await page.evaluate(() => sessionStorage.setItem("scanner:awaiting-photo", String(Date.now() - 20000)));
  await page.reload();
  check("lost photo: explained", await visible(page.getByText(/The photo didn't reach the app/)));
  entries = await waitEntries(6, 15000);
  const lostEntry = entries.find((e) => e.outcome === "lost");
  check("lost photo: logged (dated when the camera opened)", lostEntry && !lostEntry.hasPhoto && lostEntry.durationMs >= 20000, JSON.stringify(entries.map((e) => e.outcome)));
  await page.reload(); await sleep(1500);
  check("…only once", (await page.getByText(/The photo didn't reach the app/).count()) === 0);

  await browser.close();
  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} passed, ${failures.length} failed`); failures.forEach((f) => console.log("FAIL: " + f));
})().catch((e) => { console.log("CRASH: " + e.message.split("\n")[0]); console.log(`${passed} passed; ${JSON.stringify(failures)}`); process.exit(1); });
