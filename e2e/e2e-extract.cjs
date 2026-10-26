// Extract (docs/spec-corrections.md §22): back-cover text from a photo, tidied,
// editable, shared as a .txt file or copied, kept on the phone.
const { chromium, devices } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
let passed = 0; const failures = [];
const check = (name, cond, extra = "") => { if (cond) passed++; else failures.push(name + (extra ? ` — ${extra}` : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (loc, t = 15000) => loc.first().waitFor({ state: "visible", timeout: t }).then(() => true, () => false);

// A phone photo (3000×4000) of a back cover: Finnish blurb, lines broken by the cover's width.
const cover = (page, lines, turn = 0) => page.evaluate(([lines, turn]) => {
  const c = document.createElement("canvas"); c.width = 3000; c.height = 4000;
  const x = c.getContext("2d"); x.fillStyle = "#4a3b2c"; x.fillRect(0, 0, 3000, 4000);
  x.translate(1500, 2000); x.rotate((turn * Math.PI) / 180); x.translate(-1500, -2000);
  x.fillStyle = "#f3eee2"; x.fillRect(250, 300, 2500, 3400);
  x.fillStyle = "#1d1d1d"; x.font = "64px Georgia, serif";
  let y = 600;
  for (const l of lines) { if (l) x.fillText(l, 400, y); y += l ? 100 : 80; }
  x.setTransform(1, 0, 0, 1, 0, 0);
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, [lines, turn]);
const BLURB = [
  "Väinö Linnan romaani kertoo suomalaisesta",
  "konekiväärikomppaniasta jatkosodassa. Kirjoit-",
  "taja kuvaa sotilaiden arkea, pelkoa ja huu-",
  "moria lämmöllä ja tarkasti.",
  "",
  "Teos on myyty yli miljoona kappaletta.",
];
const MORE = ["Kansi: Otava. Painettu EU-", "maissa vuonna 2004."];

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://127.0.0.1:8788", permissions: ["clipboard-read", "clipboard-write"] });
  // The phone's share menu, recorded instead of opened.
  await ctx.addInitScript(() => {
    window.__shared = [];
    navigator.canShare = (d) => Boolean(d && d.files && d.files.length);
    navigator.share = async (d) => { for (const f of d.files || []) window.__shared.push({ name: f.name, type: f.type, text: await f.text() }); if (d.text) window.__shared.push({ text: d.text }); };
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(String(e)));
  const take = async (b64) => page.getByLabel("Text photo").setInputFiles({ name: "IMG.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") });
  const box = page.getByLabel(/Text — check and correct it/);

  await page.goto("/extract");
  check("explains what it's for", await visible(page.getByText(/to get it onto the computer/)));
  check("one big button to start", await visible(page.getByRole("button", { name: "Take a photo of the text" })));

  await take(await cover(page, BLURB));
  check("text read from the photo", await visible(box, 120000));
  const text = await box.inputValue();
  check("Finnish letters read right (ä, ö)", /Väinö/.test(text) && /lämmöllä/.test(text), text);
  check("lines broken by the cover joined into a paragraph", /suomalaisesta konekiväärikomppaniasta/.test(text), text);
  check("hyphenated words rejoined", /Kirjoittaja/.test(text) && /huumoria/.test(text), text);
  check("paragraph break kept", /tarkasti\.\n\nTeos/.test(text), JSON.stringify(text));
  check("word count shown", await visible(page.getByText(/^\d+ words$/)));

  // Share: a .txt file named after the first words.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await sleep(500);
  const shared = await page.evaluate(() => window.__shared);
  check("Share sends a .txt file", shared.length === 1 && shared[0].type === "text/plain" && /^vaino-linnan-romaani-kertoo-\d{4}-\d\d-\d\d-\d{4}\.txt$/.test(shared[0].name), JSON.stringify(shared).slice(0, 200));
  check("…holding the text", shared[0] && shared[0].text.trim() === text.trim());
  check("explains OneDrive", await visible(page.getByText(/choose OneDrive/)));

  // Copy.
  await page.getByRole("button", { name: "Copy" }).click();
  check("Copy says so", await visible(page.getByRole("button", { name: /Copied/ })));
  check("…and copies the text", (await page.evaluate(() => navigator.clipboard.readText())).trim() === text.trim());

  // Corrections are kept, also across closing the app.
  await box.fill(text.replace("Teos on", "Kirja on"));
  await page.reload();
  check("edited text kept on the phone", /Kirja on myyty/.test(await box.inputValue()));

  // Another photo adds to the end.
  await take(await cover(page, MORE));
  await page.waitForFunction(() => /maissa/.test(document.querySelector("textarea").value), null, { timeout: 120000 }).catch(() => {});
  const both = await box.inputValue();
  check("another photo adds its text at the end", /Kirja on myyty/.test(both) && /\n\nKansi: Otava\. Painettu EU-maissa vuonna 2004\./.test(both), JSON.stringify(both.slice(-120)));

  // Sideways photo.
  await page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start over" }).click();
  check("Start over clears", await visible(page.getByRole("button", { name: "Take a photo of the text" })));
  await take(await cover(page, BLURB, 90));
  await visible(box, 180000);
  check("sideways photo read too", /konekiväärikomppaniasta/.test(await box.inputValue()), (await box.inputValue().catch(() => "")).slice(0, 120));

  // A photo with no text.
  await page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start over" }).click();
  const blank = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1200; c.height = 900; const x = c.getContext("2d"); x.fillStyle = "#8a8a8a"; x.fillRect(0, 0, 1200, 900); return c.toDataURL("image/jpeg").split(",")[1]; });
  await take(blank);
  check("no text: explained", await visible(page.getByText(/No text found in that photo/), 120000));
  await browser.close();

  // A computer's browser has no share menu: the file is saved instead.
  {
    const b = await chromium.launch();
    const p = await (await b.newContext({ baseURL: "http://127.0.0.1:8788", acceptDownloads: true })).newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto("/extract");
    await p.evaluate(() => new Promise((resolve) => { const r = indexedDB.open("shelf-address", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put("Kirjan takakansi.", "extract:text"); tx.oncomplete = () => resolve(); }; }));
    await p.reload();
    const download = p.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await p.getByRole("button", { name: "Share", exact: true }).click();
    const d = await download;
    check("no share menu: saves the .txt file", d !== null && /^kirjan-takakansi-.*\.txt$/.test(d.suggestedFilename()), d && d.suggestedFilename());
    await b.close();
  }

  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} passed, ${failures.length} failed`); failures.forEach((f) => console.log("FAIL: " + f));
})().catch((e) => { console.log("CRASH: " + e.message.split("\n")[0]); console.log(`${passed} passed; ${JSON.stringify(failures)}`); process.exit(1); });
