// seed: places
// Saved texts (spec-corrections §24): Extract's texts from a logged-in phone
// appear on the computer by themselves; corrections follow; Copy, Download,
// Done, Delete; behind the access code; laid out for a big screen.
const { suite, browser, phone, visible, sleep, sql, chromium, BASE_URL } = require("./lib.cjs");

const cover = (page, lines) => page.evaluate((lines) => {
  const c = document.createElement("canvas"); c.width = 2400; c.height = 3200;
  const x = c.getContext("2d"); x.fillStyle = "#f3eee2"; x.fillRect(0, 0, 2400, 3200);
  x.fillStyle = "#1d1d1d"; x.font = "64px Georgia, serif";
  lines.forEach((l, i) => x.fillText(l, 300, 500 + i * 100));
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, lines).then((b64) => Buffer.from(b64, "base64"));
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
  await page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start over" }).click();
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
  await page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start over" }).click();
  check("start over keeps the first one saved", rows().length === 1);
  await sleep(1100); // a different minute isn't needed, just a later time
  await take(["second"]);
  await page.waitForFunction(() => /Väinö/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 });
  await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved —/), 15000);
  check("start over: the next reading is a new text", rows().length === 2);
  check("computer: both listed, newest first", await pc.waitForFunction(() => document.querySelectorAll("[aria-label='Saved texts'] li").length === 2, null, { timeout: 15000 }).then(() => true, () => false));

  // Copy and download on the computer.
  const first = list.getByRole("button").last(); // the older one (the corrected text)
  await first.click();
  await pc.getByRole("button", { name: "Copy" }).click();
  check("Copy copies the selected text", (await pc.evaluate(() => navigator.clipboard.readText())).includes("kaksi miljoonaa"));
  const download = pc.waitForEvent("download");
  await pc.getByRole("button", { name: "Download .txt" }).click();
  const file = await download;
  check("Download gives a .txt named after the first words", /^vaino-linnan-romaani-kertoo-.*\.txt$/.test(file.suggestedFilename()), file.suggestedFilename());
  const content = require("fs").readFileSync(await file.path(), "utf8");
  check("…holding the text", content.includes("kaksi miljoonaa") && content.includes("Väinö"));

  // Correcting on the computer.
  const editBox = pc.getByRole("region", { name: "Selected text" }).getByLabel("Text");
  await editBox.fill((await editBox.inputValue()).replace("Väinö Linnan romaani", "Väinö Linnan rakastettu romaani"));
  check("computer: correction saves by itself", await visible(pc.getByRole("status", { name: "Correction" }).getByText(/Correction saved/), 10000));
  const corrected = rows().find((r) => r.text.includes("rakastettu"));
  check("…stored, marked as corrected on the computer", corrected && sql(`SELECT edited_on_computer_at FROM saved_texts WHERE id = '${corrected.id}'`)[0].edited_on_computer_at, JSON.stringify(rows()));
  await pc.waitForTimeout(6000); // a refresh or two
  check("…and the refresh doesn't undo it", (await editBox.inputValue()).includes("rakastettu"));
  await pc.getByRole("button", { name: "Copy" }).click();
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
  await page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start over" }).click();
  await take(["third"]);
  await page.waitForFunction(() => /Väinö/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 });
  await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved —/), 15000);
  const before = rows().length;
  await page.context().setOffline(true);
  await box.fill((await box.inputValue()) + "\n\nLisätty ilman signaalia.");
  check("no signal: says it'll save later", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/No signal — it'll be saved/), 15000));
  check("…not on the server yet", !rows().some((r) => r.text.includes("ilman signaalia")));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  let synced = false;
  for (let i = 0; i < 20 && !synced; i++) { await sleep(500); synced = rows().some((r) => r.text.includes("ilman signaalia")); }
  check("back online: saved by itself", synced && rows().length === before);
  check("computer: shows it", await visible(pc.locator("[aria-label='Saved texts']").getByRole("button", { name: /Väinö/ }).first(), 15000));

  await b.close();
  t.done();
})().catch(t.crash);
