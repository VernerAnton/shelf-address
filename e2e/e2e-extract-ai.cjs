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
  // Start over goes straight to the camera (V28): the camera is let go unused here.
  const startOver = async () => {
    const camera = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: "Start over" }).click();
    return camera;
  };
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
  await startOver();

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
  check("asked Gemini 3.1 Flash-Lite (the default since V33.9) on OpenRouter, with the key from the server", req.model === "google/gemini-3.1-flash-lite" && req.auth === "Bearer test-openrouter-key" && req.temperature === 0, JSON.stringify({ ...req, prompt: undefined }));
  check("photo made smaller before sending (≤ 2000 px, JPEG)", req.imageType === "image/jpeg" && Math.max(req.width, req.height) === 2000 && req.imageBytes < 1500000, JSON.stringify({ w: req.width, h: req.height, bytes: req.imageBytes }));
  check("told to copy exactly, keep ä/ö/å, skip stickers and barcodes", /exactly, word for word/.test(req.prompt) && /ä, ö, å/.test(req.prompt) && /price stickers, barcodes/.test(req.prompt));
  check("room for a long answer (20,000 tokens)", req.maxTokens === 20000, String(req.maxTokens));
  check("…with thinking off", req.reasoning && req.reasoning.effort === "none", JSON.stringify(req.reasoning));
  check("…and the fastest-answering provider asked for", req.provider && req.provider.sort === "latency", JSON.stringify(req.provider));

  // Start over sits at the top, right under the photo button (V26).
  const another = page.getByRole("button", { name: "Add another photo" });
  const startOverButton = page.getByRole("button", { name: "Start over" });
  const [ya, ys, yt] = await Promise.all([another, startOverButton, box].map((l) => l.boundingBox().then((r) => r && r.y)));
  check("Start over right under Add another photo, above the text", ya < ys && ys < yt && (await startOverButton.count()) === 1, JSON.stringify([ya, ys, yt]));

  // Report a reading (V26): the note is optional.
  const reportArea = page.getByRole("region", { name: "Report a problem" });
  await reportArea.getByRole("button", { name: "Report a problem" }).click();
  check("report form: note marked optional", await visible(reportArea.getByText("(optional)")));
  await reportArea.getByRole("button", { name: "Send report" }).click();
  check("report sent without a note", await visible(reportArea.getByText(/✓ Reported/), 15000));

  // The AI runs out of room: says the end may be missing, and the report shows why.
  await ai("length");
  await take(await cover(page, PHONE_TEXT));
  check("AI stopped early: warned the end may be missing", await visible(page.getByText(/The AI stopped early — the end of the text may be missing/), 30000));
  check("…and the Report button is back for the new photo", await visible(reportArea.getByRole("button", { name: "Report a problem" })));
  await reportArea.getByRole("button", { name: "Report a problem" }).click();
  await reportArea.getByLabel(/What went wrong/).fill("cut off after the first sentence");
  await reportArea.getByRole("button", { name: "Send report" }).click();
  check("report with a note sent", await visible(reportArea.getByText(/✓ Reported/), 15000));
  await ai("ok");

  const logPage = await b.newPage();
  let reported = [];
  for (let i = 0; i < 20 && reported.length < 2; i++) {
    await logPage.goto(new URL("/photo-log", page.url()).href);
    reported = await logPage.getByRole("listitem").filter({ hasText: "Extract: reported problem" }).all();
    if (reported.length < 2) await sleep(500);
  }
  check("both reports in the Photo log", reported.length === 2, String(reported.length));
  const newest = reported[0];
  check("…the note shown", await visible(newest.getByText("Reported: cut off after the first sentence")));
  check("…with the photo", (await newest.getByRole("img", { name: "Photo" }).count()) === 1);
  await newest.locator("summary").click();
  const detail = await newest.locator("pre").innerText();
  check("…why it stopped, the tokens and the reply", /Stopped because: length — ran out of room/.test(detail) && /answer 20,000 of at most 20,000 \(thinking 19,988\)/.test(detail) && /Väinö Linnan romaani kertoo suomalaisesta/.test(detail), detail);
  const older = await reported[1].locator("pre").evaluate((el) => el.textContent);
  check("…and who served it, with how much thinking was allowed", /served by Google AI Studio, thinking: none/.test(detail), detail);
  check("first report: no note, finished normally", /Note: \(none\)/.test(older) && /Stopped because: stop\n/.test(older), older);
  check("summary counts the reports", await visible(logPage.getByLabel("Summary").getByText(/2 reported from Extract/)));
  await logPage.close();

  // Stays logged in, and each visit renews the login (browsers keep cookies 400 days at most).
  const firstExpiry = cookie.expires;
  await sleep(2000);
  await page.reload();
  check("still logged in after closing and opening", await visible(page.getByText(/Read by AI/)) && (await login.count()) === 0);
  await sleep(500);
  const renewed = (await page.context().cookies()).find((c) => c.name === "extract_login");
  check("…and the login renewed by the visit", renewed && renewed.expires > firstExpiry + 1, JSON.stringify([firstExpiry, renewed && renewed.expires]));

  // Choosing the model on the phone (V33.4): kept per phone, and only models on the server's list.
  const pick = page.getByLabel("AI model");
  check("model choice: Gemini by default", await visible(pick) && (await pick.inputValue()) === "");
  check("…Grok 4.20 isn't offered any more (V33.5)", (await pick.locator("option").allInnerTexts()).every((o) => !/Grok/.test(o)));
  await pick.selectOption({ label: "Gemini 3.8 Flash · standard" });
  await startOver();
  await take(await cover(page, PHONE_TEXT));
  await page.waitForFunction(() => /konekiväärikomppaniasta/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 });
  const std = (await ai()).requests.at(-1);
  check("standard chosen: asked for without Nitro, fastest provider by our own sort", std.model === "google/gemini-3.8-flash" && std.provider && std.provider.sort === "latency", JSON.stringify([std.model, std.provider]));
  check("…and the phone says so", (await page.getByLabel("Model", { exact: true }).innerText()).includes("Gemini 3.8 Flash · standard"));
  await page.reload();
  check("…the choice is kept on the phone", (await page.getByLabel("AI model").inputValue()) === "google/gemini-3.8-flash");
  await page.getByLabel("AI model").selectOption({ label: "Gemini 3.1 Flash-Lite · no thinking (default)" });
  const sneaky = await page.request.post("/api/extract", { data: (await cover(page, PHONE_TEXT)), headers: { "content-type": "image/jpeg", "x-model": "openai/some-expensive-model" } });
  check("a model not on the list isn't used: the default reads it", sneaky.ok() && (await ai()).requests.at(-1).model === "google/gemini-3.1-flash-lite", (await ai()).requests.at(-1).model);

  // Flash-Lite: thinking off (V33.7); if a model won't switch it off after all, asked again with minimal.
  await page.getByLabel("AI model").selectOption({ label: "Gemini 3.1 Flash-Lite · no thinking (default)" });
  await startOver();
  await take(await cover(page, PHONE_TEXT));
  await page.waitForFunction(() => /konekiväärikomppaniasta/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 });
  const lite = (await ai()).requests.at(-1);
  check("Flash-Lite chosen: asked with thinking off", lite.model === "google/gemini-3.1-flash-lite" && lite.reasoning && lite.reasoning.effort === "none", JSON.stringify([lite.model, lite.reasoning]));
  // A model that stops part-way with an error (V33.8): read again with the default, and the phone says so.
  await ai("cutoff");
  await startOver();
  await take(await cover(page, PHONE_TEXT));
  check("cut off with an error: read again with the default, the whole text", await page.waitForFunction(() => /miljoona kappaletta/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 }).then(() => true, () => false));
  const pair = (await ai()).requests.slice(-2).map((r) => r.model);
  check("…first Flash-Lite, then 3.8 Flash · Nitro", JSON.stringify(pair) === JSON.stringify(["google/gemini-3.1-flash-lite", "google/gemini-3.8-flash:nitro"]), JSON.stringify(pair));
  check("…and the phone says so", await visible(page.getByText(/Gemini 3\.1 Flash-Lite · no thinking stopped part-way with an error, so Gemini 3\.8 Flash · Nitro read it instead/)));
  await ai("nonone");
  await startOver();
  await take(await cover(page, PHONE_TEXT));
  check("thinking can't be off: read by AI all the same", await page.waitForFunction(() => /konekiväärikomppaniasta/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 }).then(() => true, () => false) && (await page.getByText(/so the phone did/).count()) === 0);
  const stepDown = (await ai()).requests.slice(-2).map((r) => r.reasoning && r.reasoning.effort);
  check("…asked with none, then minimal", JSON.stringify(stepDown) === JSON.stringify(["none", "minimal"]), JSON.stringify(stepDown));
  await ai("ok");
  await page.getByLabel("AI model").selectOption({ label: "Gemini 3.1 Flash-Lite · no thinking (default)" });

  // A model that refuses the speed settings (V32): asked again plainly, still read by AI.
  await ai("picky");
  await startOver();
  await take(await cover(page, PHONE_TEXT));
  check("speed settings refused: read by AI all the same", await page.waitForFunction(() => /konekiväärikomppaniasta/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 }).then(() => true, () => false) && (await page.getByText(/so the phone did/).count()) === 0);
  const tries = (await ai()).requests.slice(-2);
  check("…the second try without them", tries.length === 2 && tries[0].reasoning && !tries[1].reasoning && !tries[1].provider, JSON.stringify(tries.map((r) => [r.reasoning, r.provider])));
  await ai("ok");

  // The spending limit reached: the phone reads it instead, and says why.
  await ai("limit");
  await startOver();
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
