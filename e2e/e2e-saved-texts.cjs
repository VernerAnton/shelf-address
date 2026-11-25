// seed: places
// Saved texts (spec-corrections §24): Extract's texts from a logged-in phone
// appear on the computer by themselves; corrections follow; Copy, Done,
// Delete; behind the access code; laid out for a big screen. Since V28 (§28):
// the front cover photo, the AI's back photos kept, reporting from the computer.
const { suite, browser, phone, visible, sleep, sql, chromium, BASE_URL } = require("./lib.cjs");

const cover = (page, lines) => page.evaluate((lines) => {
  const c = document.createElement("canvas"); c.width = 2400; c.height = 3200;
  const x = c.getContext("2d"); x.fillStyle = "#f3eee2"; x.fillRect(0, 0, 2400, 3200);
  x.fillStyle = "#1d1d1d"; x.font = "64px Georgia, serif";
  lines.forEach((l, i) => x.fillText(l, 300, 500 + i * 100));
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, lines).then((b64) => Buffer.from(b64, "base64"));
// A front cover photo straight from a phone camera (3000×4000).
const frontCover = (page, colour) => page.evaluate((colour) => {
  const c = document.createElement("canvas"); c.width = 3000; c.height = 4000;
  const x = c.getContext("2d"); x.fillStyle = colour; x.fillRect(0, 0, 3000, 4000);
  for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`; x.fillRect((i * 131) % 2900, (i * 197) % 3900, 100, 100); }
  x.fillStyle = "#fff"; x.font = "bold 220px Georgia, serif"; x.fillText("TUNTEMATON", 300, 1200);
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, colour).then((b64) => Buffer.from(b64, "base64"));
// A JPEG's size, from its SOF marker.
const jpegSize = (buf) => {
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
};
const AI_TEXT = "Väinö Linnan romaani kertoo suomalaisesta konekiväärikomppaniasta jatkosodassa.\n\nTeos on myyty yli miljoona kappaletta.";
const logIn = async (page) => {
  const form = page.getByRole("form", { name: "AI reading login" });
  await form.getByLabel(/access code/).fill("test-code");
  await form.getByRole("button", { name: "Log in" }).click();
};

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  const page = await phone(b, t, { permissions: ["camera", "clipboard-read", "clipboard-write"] });
  // The computer: a desktop-sized window, its own browser session.
  const pcCtx = await b.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 860 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const pc = await pcCtx.newPage();
  pc.setDefaultTimeout(20000);
  pc.on("pageerror", (e) => t.errors.push(String(e)));
  const rows = () => sql("SELECT id, text, source, done_at FROM saved_texts ORDER BY created_at");
  const box = page.getByLabel(/Text — check and correct it/);
  // Start over goes straight to the camera (V28); the camera is let go unused here.
  const startOver = async () => {
    const camera = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: "Start over" }).click();
    return camera;
  };
  const take = async (lines) => page.getByLabel("Text photo").setInputFiles({ name: "IMG.jpg", mimeType: "image/jpeg", buffer: await cover(page, lines) });

  // Not logged in anywhere: nothing saved, and the list needs the code.
  await page.goto("/extract");
  await take(["Kotimainen romaani kesästä saaristossa."]);
  await visible(box, 120000);
  await sleep(2000);
  check("phone not logged in: nothing saved for the computer", rows().length === 0);
  check("…and no 'saved' line", (await page.getByRole("status", { name: "Saved for the computer" }).count()) === 0);
  const refused = await pc.request.get("/api/extract/texts");
  check("the list can't be read without the code", refused.status() === 401);
  // A computer opens straight on Saved texts — from the app's address, and from the Extract tab.
  await pc.goto("/");
  check("computer: the app opens on Saved texts", await pc.waitForURL(/\/extract\/saved$/).then(() => true, () => false), pc.url());
  await pc.goto("/extract");
  check("computer: the Extract tab goes to Saved texts too", /\/extract\/saved$/.test(pc.url()), pc.url());
  await page.goto("/");
  check("phone: still opens on Evaluate", await page.waitForURL(/\/evaluate$/).then(() => true, () => false), page.url());
  await page.goto("/extract");
  check("phone: Extract tab is still the camera", await visible(page.getByRole("heading", { name: "Extract" })));
  await pc.goto("/extract/saved");
  check("computer: asks for the access code", await visible(pc.getByRole("form", { name: "AI reading login" }).getByText("Saved texts need the access code")));
  await logIn(pc);
  check("computer: logged in, empty list explained", await visible(pc.getByText(/Nothing saved yet/)));

  // Phone logs in; a reading is saved and shows on the computer by itself.
  await startOver();
  await logIn(page);
  await visible(page.getByText(/Read by AI/));
  await take(["anything"]);
  const aiRead = await page.waitForFunction(() => /konekiväärikomppaniasta/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 }).then(() => true, () => false);
  check("phone: AI text read", aiRead);
  check("phone: says it's saved for the computer", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved — it's on the computer/), 15000));
  check("stored once, marked as read by AI", rows().length === 1 && rows()[0].text === AI_TEXT && rows()[0].source === "ai", JSON.stringify(rows()));
  const list = pc.locator("[aria-label='Saved texts']");
  check("computer: appears without reloading", await visible(list.getByRole("button", { name: /Väinö Linnan romaani/ }), 15000));
  const shown = pc.getByRole("region", { name: "Selected text" }).getByLabel("Text");
  check("computer: newest opened straight away, in full", await visible(shown) && (await shown.inputValue()).trim() === AI_TEXT);

  // A correction on the phone follows.
  await box.fill(AI_TEXT.replace("miljoona", "kaksi miljoonaa"));
  check("phone: correction saved", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved — it's on the computer/), 15000));
  check("computer: the correction shows up", await pc.waitForFunction(() => /kaksi miljoonaa/.test(document.querySelector("[aria-label='Selected text'] [aria-label='Text']")?.value ?? ""), null, { timeout: 15000 }).then(() => true, () => false));
  check("still one text, not two", rows().length === 1);

  // Start over: a new text, newest first.
  await startOver();
  check("start over keeps the first one saved", rows().length === 1);
  await sleep(1100); // a different minute isn't needed, just a later time
  await take(["second"]);
  await page.waitForFunction(() => /Väinö/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 });
  await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved —/), 15000);
  check("start over: the next reading is a new text", rows().length === 2);
  check("computer: both listed, newest first", await pc.waitForFunction(() => document.querySelectorAll("[aria-label='Saved texts'] li").length === 2, null, { timeout: 15000 }).then(() => true, () => false));

  // The AI's back photos are kept with their texts (V28), for reporting from the computer.
  const readings = () => sql("SELECT text_id, photo_key, reply FROM saved_text_readings ORDER BY read_at");
  const textIds = rows().map((r) => r.id);
  check("each back photo the AI read is kept with its text, with the answer", readings().length === 2 && readings().every((r) => textIds.includes(r.text_id) && r.photo_key && /konekiväärikomppaniasta/.test(r.reply)), JSON.stringify(readings()));

  // Front cover (V28): after the back text, a photo of the front goes to the computer.
  const coverArea = page.getByRole("region", { name: "Front cover" });
  check("phone: front cover button after the back text", await visible(coverArea.getByRole("button", { name: "Take a photo of the front cover" })));
  await page.getByLabel("Front cover photo").setInputFiles({ name: "COVER.jpg", mimeType: "image/jpeg", buffer: await frontCover(page, "#7a1f1f") });
  check("phone: says the front cover is saved", await visible(coverArea.getByText("✓ Front cover saved for the computer"), 15000));
  const newest = rows().at(-1);
  const withCover = () => sql("SELECT id, cover_key FROM saved_texts WHERE cover_key IS NOT NULL");
  check("stored with the text it was taken for", withCover().length === 1 && withCover()[0].id === newest.id, JSON.stringify(withCover()));
  const firstKey = withCover()[0]?.cover_key;
  const pic = await pc.request.get(`/api/extract/texts/${newest.id}/cover`);
  const size = jpegSize(await pic.body());
  check("…made 1600 px on its long side, as a JPEG", pic.ok() && size && Math.max(size.width, size.height) === 1600, JSON.stringify(size));
  check("…and only for the logged in", (await fetch(`${BASE_URL}/api/extract/texts/${newest.id}/cover`)).status === 401);
  check("phone: no preview or retake button (the camera asks)", (await coverArea.getByRole("img").count()) === 0 && (await page.getByRole("button", { name: /Retake/ }).count()) === 0);
  await page.getByLabel("Front cover photo").setInputFiles({ name: "COVER.jpg", mimeType: "image/jpeg", buffer: await frontCover(page, "#1f3a7a") });
  await sleep(1500);
  check("another photo replaces it", withCover().length === 1 && withCover()[0].cover_key !== firstKey, JSON.stringify(withCover()));

  // On the computer: large, beside the text.
  await list.getByRole("button").first().click();
  const figure = pc.getByRole("figure", { name: "Front cover" });
  check("computer: the front cover shows", await visible(figure.getByRole("img", { name: "Front cover" })));
  await pc.waitForFunction(() => document.querySelector("figure img")?.naturalWidth > 0, null, { timeout: 10000 }).catch(() => {});
  const placed = await pc.evaluate(() => {
    const img = document.querySelector("figure img").getBoundingClientRect();
    const text = document.querySelector("[aria-label='Selected text'] textarea").getBoundingClientRect();
    return { beside: img.left >= text.right, tall: img.height, textTall: text.height, whole: document.querySelector("figure img").naturalWidth > 0 };
  });
  check("…beside the text, at least as tall as the text box, big enough to judge", placed.beside && placed.whole && placed.tall >= 300 && placed.tall >= placed.textTall - 4, JSON.stringify(placed));
  check("…and a small one in the list", (await list.getByRole("button").first().locator("img").count()) === 1 && (await list.getByRole("button").last().locator("img").count()) === 0);
  // A big screen (like the shop's, 1536×730 in the browser): the page grows to use the width (V28).
  await pc.setViewportSize({ width: 1536, height: 730 });
  await sleep(300);
  const wide = await pc.evaluate(() => {
    const tops = [...document.querySelectorAll("[aria-label='Selected text'] button")].filter((x) => /^(Copy|✓ Mark done|Delete|Report a problem)$/.test(x.textContent.trim())).map((x) => Math.round(x.getBoundingClientRect().top));
    return { main: document.querySelector("main").getBoundingClientRect().width, rows: new Set(tops).size, scroll: document.documentElement.scrollHeight - innerHeight, cover: document.querySelector("figure img").getBoundingClientRect().height };
  });
  check("big screen with a cover: the page uses the width, buttons on one row, no scrolling", wide.main > 1400 && wide.rows === 1 && wide.scroll <= 1 && wide.cover >= 400, JSON.stringify(wide));
  await pc.setViewportSize({ width: 1280, height: 860 });
  await figure.getByRole("button", { name: "Copy picture" }).click();
  check("Copy picture puts the picture on the clipboard", await visible(figure.getByRole("button", { name: "Picture copied ✓" })) && (await pc.evaluate(async () => (await navigator.clipboard.read())[0].types)).includes("image/png"));
  const picFile = pc.waitForEvent("download");
  await figure.getByRole("link", { name: "Download picture" }).click();
  const saved = await picFile;
  check("Download picture: a .jpg named after the book", /^etukansi-vaino-linnan-romaani.*\.jpg$/.test(saved.suggestedFilename()), saved.suggestedFilename());
  await figure.getByRole("img", { name: "Front cover" }).click();
  const full = pc.getByRole("dialog", { name: "Front cover, full size" });
  check("click: full size", await visible(full));
  await pc.keyboard.press("Escape");
  check("…Esc closes it", await full.waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false));
  check("no Download .txt any more", (await pc.getByRole("button", { name: "Download .txt" }).count()) === 0);

  // Reporting from the computer (V28): the back photo, the AI's answer and the text now go to the Photo log.
  await pc.getByRole("button", { name: "Report a problem" }).click();
  const pcReport = pc.getByRole("region", { name: "Report a problem" });
  await pcReport.getByLabel(/What went wrong/).fill("viimeinen lause puuttuu");
  await pcReport.getByRole("button", { name: "Send report" }).click();
  check("computer: report sent", await visible(pcReport.getByText(/✓ Reported/), 15000));
  const logged = sql("SELECT error, ocr_text, photo_key FROM photo_log WHERE screen = '/extract/saved'");
  check("…in the Photo log with the back photo, the note, the answer and the text now", logged.length === 1 && logged[0].photo_key && /viimeinen lause puuttuu/.test(logged[0].error) && /— What came back —\nVäinö Linnan/.test(logged[0].ocr_text) && /— The text now —/.test(logged[0].ocr_text) && /Stopped because: stop/.test(logged[0].ocr_text), JSON.stringify(logged).slice(0, 400));
  const logView = await pcCtx.newPage();
  await logView.goto("/photo-log");
  check("…shown there as reported on the computer, with the photo", await visible(logView.getByRole("listitem").filter({ hasText: "Extract: reported on the computer" }).getByRole("img", { name: "Photo" })));
  await logView.close();

  // Copy on the computer (kept).
  const first = list.getByRole("button").last(); // the older one (the corrected text)
  await first.click();
  await pc.getByRole("button", { name: "Copy", exact: true }).click();
  check("Copy copies the selected text", (await pc.evaluate(() => navigator.clipboard.readText())).includes("kaksi miljoonaa"));

  // Correcting on the computer.
  const editBox = pc.getByRole("region", { name: "Selected text" }).getByLabel("Text");
  await editBox.fill((await editBox.inputValue()).replace("Väinö Linnan romaani", "Väinö Linnan rakastettu romaani"));
  check("computer: correction saves by itself", await visible(pc.getByRole("status", { name: "Correction" }).getByText(/Correction saved/), 10000));
  const corrected = rows().find((r) => r.text.includes("rakastettu"));
  check("…stored, marked as corrected on the computer", corrected && sql(`SELECT edited_on_computer_at FROM saved_texts WHERE id = '${corrected.id}'`)[0].edited_on_computer_at, JSON.stringify(rows()));
  await pc.waitForTimeout(6000); // a refresh or two
  check("…and the refresh doesn't undo it", (await editBox.inputValue()).includes("rakastettu"));
  await pc.getByRole("button", { name: "Copy", exact: true }).click();
  check("Copy copies the corrected text", (await pc.evaluate(() => navigator.clipboard.readText())).includes("rakastettu"));
  await editBox.fill("   ");
  check("emptying it is refused (Delete is for that)", await visible(pc.getByRole("status", { name: "Correction" }).getByText(/can't be empty/), 10000));
  check("…and the text is kept", rows().some((r) => r.text.includes("rakastettu")));
  await editBox.fill(corrected.text);
  await visible(pc.getByRole("status", { name: "Correction" }).getByText(/Correction saved/), 10000);

  // The phone's current text corrected on the computer, then the phone types: the computer's version stays.
  await list.getByRole("button").first().click();
  await editBox.fill((await editBox.inputValue()) + "\n\nKoneella lisätty lause.");
  await visible(pc.getByRole("status", { name: "Correction" }).getByText(/Correction saved/), 10000);
  await box.fill((await box.inputValue()) + " Puhelimella lisätty.");
  check("phone: says it's been corrected on the computer, not saved here", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/corrected on the computer, so changes here aren't saved/), 15000));
  await sleep(1000);
  check("…and the computer's version is kept", rows().some((r) => r.text.includes("Koneella lisätty")) && !rows().some((r) => r.text.includes("Puhelimella lisätty")));
  await list.getByRole("button").last().click();

  // Done, not done, delete.
  check("two texts to do, no Done section yet", await visible(pc.getByRole("heading", { name: "To do (2)" })) && (await pc.getByRole("region", { name: "Done" }).count()) === 0);
  await pc.getByRole("button", { name: "✓ Mark done" }).click();
  const doneSection = pc.getByRole("region", { name: "Done" });
  check("Mark done: moves it down to the Done section", await visible(doneSection.getByRole("button", { name: /Väinö/ })) && await visible(pc.getByRole("heading", { name: "To do (1)" })));
  check("…and the next text to do opens", (await pc.getByRole("region", { name: "To do" }).getByRole("button").first().getAttribute("aria-current")) === "true");
  await sleep(1000);
  check("…stored", rows().filter((r) => r.done_at).length === 1);
  await doneSection.getByRole("button").first().click();
  await pc.getByRole("button", { name: "Not done" }).click();
  check("Not done: back up to To do", await visible(pc.getByRole("heading", { name: "To do (2)" })) && (await pc.getByRole("region", { name: "Done" }).count()) === 0);
  await sleep(1000);
  check("Not done undoes it", rows().every((r) => !r.done_at));
  pc.once("dialog", (d) => d.accept());
  await pc.getByRole("button", { name: "Delete" }).click();
  await sleep(1000);
  check("Delete removes it", rows().length === 1 && (await list.getByRole("button").count()) === 1);
  check("…with its kept back photo", readings().length === 1 && readings()[0].text_id === rows()[0].id, JSON.stringify(readings()));

  // Big screen: list and text side by side.
  await list.getByRole("button").first().click();
  const layout = await pc.evaluate(() => {
    const l = document.querySelector("[aria-label='Saved texts']").getBoundingClientRect();
    const d = document.querySelector("[aria-label='Selected text']").getBoundingClientRect();
    return { side: l.right <= d.left, wide: d.width > 600, top: Math.abs(l.top - d.top) < 60 };
  });
  check("computer: list on the left, the text on the right", layout.side && layout.wide && layout.top, JSON.stringify(layout));
  await pc.screenshot({ path: ".wrangler/saved-desktop.png" });

  // On the phone: the list, then a tap opens one.
  await page.goto("/extract/saved");
  const plist = page.locator("[aria-label='Saved texts']");
  check("phone: the list (already logged in)", await visible(plist));
  check("phone: no text open yet", (await page.getByRole("region", { name: "Selected text" }).count()) === 0);
  await plist.getByRole("button").first().click();
  check("phone: tap opens it, list hidden", await visible(page.getByRole("region", { name: "Selected text" })) && !(await plist.isVisible()));
  await page.screenshot({ path: ".wrangler/saved-phone.png" });
  await page.getByRole("button", { name: "← All texts" }).click();
  check("phone: back to the list", await visible(plist));

  // No signal: waits on the phone, goes up later.
  await page.goto("/extract");
  await startOver();
  await take(["third"]);
  await page.waitForFunction(() => /Väinö/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 });
  await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved —/), 15000);
  const before = rows().length;
  await page.context().setOffline(true);
  await box.fill((await box.inputValue()) + "\n\nLisätty ilman signaalia.");
  check("no signal: says it'll save later", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/No signal — it'll be saved/), 15000));
  check("…not on the server yet", !rows().some((r) => r.text.includes("ilman signaalia")));
  const coversBefore = withCover().length;
  await page.getByLabel("Front cover photo").setInputFiles({ name: "COVER.jpg", mimeType: "image/jpeg", buffer: await frontCover(page, "#2f6a2f") });
  check("no signal: the front cover waits too, and says so", await visible(coverArea.getByText(/No signal — the front cover will be saved by itself/), 15000));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  let synced = false;
  for (let i = 0; i < 20 && !synced; i++) { await sleep(500); synced = rows().some((r) => r.text.includes("ilman signaalia")); }
  check("back online: saved by itself", synced && rows().length === before);
  let coverUp = false;
  for (let i = 0; i < 20 && !coverUp; i++) { await sleep(500); coverUp = withCover().length === coversBefore + 1; }
  check("…and the front cover goes up after it", coverUp, JSON.stringify(withCover()));
  check("computer: shows it", await visible(pc.locator("[aria-label='Saved texts']").getByRole("button", { name: /Väinö/ }).first(), 15000));

  // Kept 7 days after the last change (V27): one changed 8 days ago goes, 6 days ago stays.
  const daysAgo = (d) => new Date(Date.now() - d * 24 * 3600e3).toISOString();
  sql(`INSERT INTO saved_texts (id, text, source, created_at, updated_at) VALUES ('old-8-days', 'Kahdeksan päivää', 'ai', '${daysAgo(9)}', '${daysAgo(8)}'), ('old-6-days', 'Kuusi päivää', 'ai', '${daysAgo(9)}', '${daysAgo(6)}')`);
  const t1 = new Date().toISOString();
  await pc.request.put(`/api/extract/texts/${crypto.randomUUID()}`, { data: { text: "Uusi teksti.", source: "ai", createdAt: t1, updatedAt: t1 } });
  const ids = rows().map((r) => r.id);
  check("texts unchanged for over 7 days are deleted, newer kept", !ids.includes("old-8-days") && ids.includes("old-6-days"), JSON.stringify(ids));
  check("…and the page says 7 days", await visible(pc.getByText(/Kept for 7 days after their last change/)));

  // Many texts on a laptop screen (V27): the lists scroll inside themselves, the page doesn't.
  for (let i = 0; i < 30; i++) {
    const at = daysAgo(i / 24 + 0.01);
    const id = crypto.randomUUID();
    await pc.request.put(`/api/extract/texts/${id}`, { data: { text: `Teksti numero ${i + 1}, tarpeeksi pitkä kahdelle riville listassa.`, source: "ai", createdAt: at, updatedAt: at } });
    if (i % 3 === 0) await pc.request.patch(`/api/extract/texts/${id}`, { data: { done: true } });
  }
  await pc.setViewportSize({ width: 1366, height: 768 });
  await pc.reload();
  await visible(pc.getByRole("region", { name: "Selected text" }));
  await sleep(500);
  const fit = await pc.evaluate(() => ({
    page: document.documentElement.scrollHeight - innerHeight,
    lists: [...document.querySelectorAll("[aria-label='Saved texts'] ul")].map((u) => u.scrollHeight - u.clientHeight),
  }));
  check("laptop: the page itself doesn't scroll", fit.page <= 1, JSON.stringify(fit));
  check("…the To do and Done lists scroll inside themselves", fit.lists.length === 2 && fit.lists.every((x) => x > 100), JSON.stringify(fit));
  await pc.screenshot({ path: ".wrangler/saved-laptop.png" });

  await b.close();
  t.done();
})().catch(t.crash);
