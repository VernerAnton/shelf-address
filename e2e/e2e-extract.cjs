// Extract (docs/spec-corrections.md §22): back-cover text from a photo, tidied,
// editable, kept on the phone. Since V28 (§28): no Share or Copy, a big red
// Report button, Start over straight to the camera, earlier texts kept on the phone.
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
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: process.env.E2E_BASE || "http://127.0.0.1:8788" });
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

  // V28: no Share or Copy; a big red Report button instead.
  check("no Share or Copy buttons", (await page.getByRole("button", { name: /^(Share|Copy)$/ }).count()) === 0);
  const red = page.getByRole("region", { name: "Report a problem" }).getByRole("button", { name: "Report a problem" });
  check("big red Report a problem button", await visible(red) && (await red.boundingBox()).height >= 56 && /bg-danger/.test(await red.getAttribute("class")));
  check("not logged in: no front cover button (it goes to the computer)", (await page.getByRole("button", { name: "Take a photo of the front cover" }).count()) === 0);

  // Corrections are kept, also across closing the app.
  await box.fill(text.replace("Teos on", "Kirja on"));
  await page.reload();
  check("edited text kept on the phone", /Kirja on myyty/.test(await box.inputValue()));

  // Another photo adds to the end.
  await take(await cover(page, MORE));
  await page.waitForFunction(() => /maissa/.test(document.querySelector("textarea").value), null, { timeout: 120000 }).catch(() => {});
  const both = await box.inputValue();
  check("another photo adds its text at the end", /Kirja on myyty/.test(both) && /\n\nKansi: Otava\. Painettu EU-maissa vuonna 2004\./.test(both), JSON.stringify(both.slice(-120)));

  // Start over: no question, straight to the camera; the text is kept on the phone.
  let asked = false;
  page.on("dialog", (d) => { asked = true; void d.dismiss(); });
  let chooser = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  await page.getByRole("button", { name: "Start over" }).click();
  let camera = await chooser;
  check("Start over: no question asked", !asked);
  check("…opens the camera for the next back cover", camera !== null && (await camera.element().getAttribute("aria-label")) === "Text photo");
  check("…and the screen is clear", await visible(page.getByRole("button", { name: "Take a photo of the text" })));
  const earlier = page.getByRole("region", { name: "Earlier texts on this phone" });
  check("the text is kept under Earlier texts on this phone", await visible(earlier.getByRole("button", { name: "Earlier texts on this phone (1)" })));

  // Sideways photo, taken with that camera.
  await camera.setFiles({ name: "IMG.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await cover(page, BLURB, 90), "base64") });
  await visible(box, 180000);
  check("sideways photo read too", /konekiväärikomppaniasta/.test(await box.inputValue()), (await box.inputValue().catch(() => "")).slice(0, 120));

  // Earlier texts: kept across closing the app, and one can be opened again.
  chooser = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  await page.getByRole("button", { name: "Start over" }).click();
  await chooser;
  await page.reload();
  await earlier.getByRole("button", { name: "Earlier texts on this phone (2)" }).click();
  const rows = earlier.getByRole("listitem");
  check("both earlier texts listed, newest first", (await rows.count()) === 2 && /Väinö Linnan/.test(await rows.first().innerText()));
  await rows.nth(1).getByRole("button").click();
  check("tapping one opens it again", /Kansi: Otava\. Painettu EU-maissa/.test(await box.inputValue().catch(() => "")), (await box.inputValue().catch(() => "")).slice(-80));
  check("…and it leaves the list while it's open", await visible(earlier.getByRole("button", { name: "Earlier texts on this phone (1)" })));
  const kept = await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.open("shelf-address", 1); r.onsuccess = () => { const q = r.result.transaction("kv").objectStore("kv").get("extract:history"); q.onsuccess = () => resolve(q.result); }; }));
  check("earlier texts stored on the phone (one left; the other is open)", Array.isArray(kept) && kept.length === 1);
  await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.open("shelf-address", 1); r.onsuccess = () => { const s = r.result.transaction("kv", "readwrite").objectStore("kv"); const q = s.get("extract:history"); q.onsuccess = () => { const old = q.result.map((e) => ({ ...e, updatedAt: new Date(Date.now() - 8 * 24 * 3600e3).toISOString() })); s.put(old, "extract:history").onsuccess = () => resolve(); }; }; }));
  await page.reload();
  await visible(box);
  check("earlier texts dropped after 7 days", (await earlier.count()) === 0);

  // A photo with no text.
  chooser = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  await page.getByRole("button", { name: "Start over" }).click();
  await chooser;
  const blank = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1200; c.height = 900; const x = c.getContext("2d"); x.fillStyle = "#8a8a8a"; x.fillRect(0, 0, 1200, 900); return c.toDataURL("image/jpeg").split(",")[1]; });
  await take(blank);
  check("no text: explained", await visible(page.getByText(/No text found in that photo/), 120000));
  await browser.close();

  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} passed, ${failures.length} failed`); failures.forEach((f) => console.log("FAIL: " + f));
})().catch((e) => { console.log("CRASH: " + e.message.split("\n")[0]); console.log(`${passed} passed; ${JSON.stringify(failures)}`); process.exit(1); });
