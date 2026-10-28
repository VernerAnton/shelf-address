// seed: places
// Extract's AI reading (spec-corrections §23): behind an access code (only
// Extract — the rest of the app stays open), read by a vision model through the
// app's server (an OpenRouter stand-in here), the phone reader as backup.
const { suite, browser, phone, visible, sleep, BOOKS } = require("./lib.cjs");

const ai = (mode) => fetch(`${BOOKS}/__ai${mode ? `?mode=${mode}` : ""}`, { method: mode ? "POST" : "GET" }).then((r) => r.json());

// A phone photo (3000×4000) of a back cover, readable by the phone reader too.
const cover = (page, lines) => page.evaluate((lines) => {
  const c = document.createElement("canvas"); c.width = 3000; c.height = 4000;
  const x = c.getContext("2d"); x.fillStyle = "#4a3b2c"; x.fillRect(0, 0, 3000, 4000);
  x.fillStyle = "#f3eee2"; x.fillRect(250, 300, 2500, 3400);
  x.fillStyle = "#1d1d1d"; x.font = "64px Georgia, serif";
  lines.forEach((l, i) => x.fillText(l, 400, 600 + i * 100));
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, lines).then((b64) => Buffer.from(b64, "base64"));
const PHONE_TEXT = ["Kotimainen romaani kesästä saaristossa."];

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  const page = await phone(b, t);
  const box = page.getByLabel(/Text — check and correct it/);
  const login = page.getByRole("form", { name: "AI reading login" });
  const take = async (buffer) => page.getByLabel("Text photo").setInputFiles({ name: "IMG.jpg", mimeType: "image/jpeg", buffer });

  // Not logged in: the rest of the app asks for nothing.
  await page.goto("/sections");
  check("rest of the app open without any code", await visible(page.getByRole("heading", { name: "Sections" })));
  await page.goto("/evaluate");
  check("Evaluate open without any code", await visible(page.getByRole("region", { name: "Evaluate settings" })));
  const refused = await page.request.post("/api/extract", { data: Buffer.from([0xff, 0xd8, 0xff]), headers: { "content-type": "image/jpeg" } });
  check("the AI can't be used without logging in", refused.status() === 401 && (await refused.json()).kind === "login");
  check("…and the stand-in AI wasn't asked", (await ai()).requests.length === 0);

  await page.goto("/extract");
  check("Extract offers the login", await visible(login));
  check("…explaining what it's for", await visible(login.getByText(/AI reading — much better on designed covers/)));

  // Without logging in, the phone reads it.
  await take(await cover(page, PHONE_TEXT));
  check("not logged in: the phone reads it", /Kotimainen romaani/.test(await box.inputValue().catch(() => "")) || await visible(box, 120000) && /Kotimainen/.test(await box.inputValue()));
  check("…AI not asked", (await ai()).requests.length === 0);
  await page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start over" }).click();

  // Wrong code, then the right one.
  await login.getByLabel(/needs the access code/).fill("wrong");
  await login.getByRole("button", { name: "Log in" }).click();
  check("wrong code refused", await visible(login.getByText("That code isn't right.")));
  await login.getByLabel(/needs the access code/).fill("test-code");
  await login.getByRole("button", { name: "Log in" }).click();
  check("right code: logged in", await visible(page.getByText(/Read by AI/)) && (await login.count()) === 0);
  const cookie = (await page.context().cookies()).find((c) => c.name === "extract_login");
  check("login cookie: only for the AI, not readable by scripts, long-lived", cookie && cookie.path === "/api/extract" && cookie.httpOnly && cookie.sameSite === "Strict" && cookie.expires > Date.now() / 1000 + 390 * 24 * 3600, JSON.stringify(cookie));
  check("…and doesn't hold the code itself", cookie && !cookie.value.includes("test-code"));

  // AI reads it.
  await take(await cover(page, PHONE_TEXT));
  check("AI's text shown", await page.waitForFunction(() => /konekiväärikomppaniasta/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 }).then(() => true, () => false));
  const text = await box.inputValue();
  check("…exactly, paragraphs kept, formatting marks dropped", text === "Väinö Linnan romaani kertoo suomalaisesta konekiväärikomppaniasta jatkosodassa.\n\nTeos on myyty yli miljoona kappaletta.", JSON.stringify(text));
  check("…no warning", (await page.getByText(/check the text carefully|may be read wrong/).count()) === 0);
  const req = (await ai()).requests.at(-1);
  check("asked Gemini 3.8 Flash on OpenRouter, with the key from the server", req.model === "google/gemini-3.8-flash" && req.auth === "Bearer test-openrouter-key" && req.temperature === 0, JSON.stringify({ ...req, prompt: undefined }));
  check("photo made smaller before sending (≤ 2000 px, JPEG)", req.imageType === "image/jpeg" && Math.max(req.width, req.height) === 2000 && req.imageBytes < 1500000, JSON.stringify({ w: req.width, h: req.height, bytes: req.imageBytes }));
  check("told to copy exactly, keep ä/ö/å, skip stickers and barcodes", /exactly, word for word/.test(req.prompt) && /ä, ö, å/.test(req.prompt) && /price stickers, barcodes/.test(req.prompt));

  // Stays logged in, and each visit renews the login (browsers keep cookies 400 days at most).
  const firstExpiry = cookie.expires;
  await sleep(2000);
  await page.reload();
  check("still logged in after closing and opening", await visible(page.getByText(/Read by AI/)) && (await login.count()) === 0);
  await sleep(500);
  const renewed = (await page.context().cookies()).find((c) => c.name === "extract_login");
  check("…and the login renewed by the visit", renewed && renewed.expires > firstExpiry + 1, JSON.stringify([firstExpiry, renewed && renewed.expires]));

  // The spending limit reached: the phone reads it instead, and says why.
  await ai("limit");
  await page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start over" }).click();
  await take(await cover(page, PHONE_TEXT));
  check("limit used up: the phone reads it instead", await visible(page.getByText(/The AI couldn't read it \(The AI's spending limit is used up for now\), so the phone did/), 120000));
  check("…with the phone's text", /Kotimainen/.test(await box.inputValue()));

  // A broken key.
  await ai("badkey");
  await take(await cover(page, PHONE_TEXT));
  check("key not working: says so, phone reads it", await visible(page.getByText(/The AI key isn't working/), 120000));
  await ai("ok");

  // No signal.
  await page.context().setOffline(true);
  await take(await cover(page, PHONE_TEXT));
  check("no signal: phone reads it", await visible(page.getByText(/The AI couldn't read it \(no signal\), so the phone did/), 120000));
  await page.context().setOffline(false);
  check("…still logged in for next time", await visible(page.getByText(/Read by AI/)));

  // Log out.
  await page.getByRole("button", { name: "Log out" }).click();
  check("log out: the login is back", await visible(login));
  const after = await page.request.post("/api/extract", { data: Buffer.from([0xff, 0xd8, 0xff]), headers: { "content-type": "image/jpeg" } });
  check("…and the AI refuses this phone again", after.status() === 401);

  // Guessing is slowed down.
  let last;
  for (let i = 0; i < 11; i++) last = await page.request.post("/api/extract/login", { data: { code: `guess-${i}` } });
  check("after 10 wrong codes: tries refused for a while", last.status() === 429 && /Too many wrong codes/.test((await last.json()).error), String(last.status()));

  await b.close();
  t.done();
})().catch(t.crash);
