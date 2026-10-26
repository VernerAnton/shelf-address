// seed: places
// Evaluate (spec-corrections §17, §19, §20): scan a book, see its price on
// Antikvaari.fi (a stand-in here). Two switches, return detection, the
// same-book skip, typing, title search, recent list. Nothing is ever logged.
const { suite, browser, phone, visible, sql, sleep } = require("./lib.cjs");

const t = suite();
(async () => {
  const { check } = t;
  const switches = (page) => page.getByRole("region", { name: "Evaluate settings" }).getByRole("switch").evaluateAll((els) => els.map((e) => e.checked).join());
  let copiesBefore;
  {
    const b = await browser("book");
    const page = await phone(b, t);
    await page.request.post("/api/copies", { data: { id: crypto.randomUUID(), editionKey: "9789510230763", locationId: "r2", scannedAt: new Date().toISOString() } });
    await sleep(2500);
    copiesBefore = sql("SELECT COUNT(*) n FROM copies")[0].n;

    await page.goto("/scan");
    check("Scan tab doesn't start the camera by itself", await visible(page.getByRole("button", { name: "Scan with camera" })) && (await page.getByRole("button", { name: "Stop camera" }).count()) === 0);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Evaluate" }).click();
    await page.waitForURL(/\/evaluate$/);
    await page.getByRole("region", { name: "Evaluate settings" }).waitFor();
    check("both switches on by default", (await switches(page)) === "true,true");

    // Fastest flow: camera starts, a scan goes straight to Antikvaari.
    const went = await page.waitForURL(/antikvaari\.fi\/hakukone\?q=9789510366868$/, { timeout: 20000 }).then(() => true, () => false);
    check("scan opens Antikvaari straight away (same tab)", went, page.url());

    // Coming back: camera restarts, the same book isn't looked up again.
    await page.goBack();
    await page.waitForURL(/\/evaluate$/);
    check("coming back restarts the camera", await visible(page.getByRole("button", { name: "Stop camera" }), 20000));
    check("same book ignored once after coming back", await visible(page.getByText(/Same book as before/), 20000));
    await sleep(3000);
    check("no bounce back to Antikvaari", /\/evaluate$/.test(page.url()), page.url());

    // Auto-open off: the book is shown with a button.
    await page.getByRole("region", { name: "Evaluate settings" }).getByRole("switch", { name: /Open Antikvaari straight after a scan/ }).uncheck();
    await page.reload();
    const card = page.getByRole("region", { name: "Scanned book" });
    check("auto-open off: the book is shown, not opened", await visible(card.getByText("978-951036686-8"), 20000));
    await sleep(1500);
    check("…stays in the app", /\/evaluate$/.test(page.url()));
    check("link to Antikvaari's search for the ISBN", (await card.getByRole("link", { name: "Open on Antikvaari" }).getAttribute("href")) === "https://www.antikvaari.fi/hakukone?q=9789510366868");

    // Auto-resume off: coming back keeps the book on screen.
    await page.getByRole("region", { name: "Evaluate settings" }).getByRole("switch", { name: /Start scanning again/ }).uncheck();
    await card.getByRole("link", { name: "Open on Antikvaari" }).click();
    await page.waitForURL(/antikvaari\.fi/);
    await page.goBack();
    await page.waitForURL(/\/evaluate$/);
    check("auto-resume off: book kept on screen", await visible(page.getByRole("region", { name: "Scanned book" }).getByRole("button", { name: "Scan next" })));
    check("…camera stays off", (await page.getByLabel("Camera view").count()) === 0);
    check("switches remembered", (await switches(page)) === "false,false");
    await page.getByRole("button", { name: "Scan next" }).click();
    check("'Scan next' restarts the camera", await visible(page.getByRole("region", { name: "Scanned book" }).getByText("978-951036686-8"), 20000));
    await b.close();
  }
  {
    // Typing, title search, recent list, offline — on a camera that sees no barcode.
    const b = await browser("notbook");
    const page = await phone(b, t);
    await page.goto("/evaluate");
    await page.getByRole("button", { name: "Stop camera" }).click();
    check("typing box says Look up, not Log", (await page.getByRole("button", { name: "Look up", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "Log", exact: true }).count()) === 0);
    const note = await page.getByText("Saved on this phone only.").evaluate((el) => { const s = getComputedStyle(el); return [s.paddingTop, s.paddingBottom]; });
    check("settings note evenly spaced", note[0] === note[1], JSON.stringify(note));
    await page.getByLabel("Or type the ISBN").fill("9510230766");
    await page.getByLabel("Or type the ISBN").press("Enter");
    check("typed ISBN-10 opens Antikvaari with the ISBN-13", await page.waitForURL(/antikvaari\.fi\/hakukone\?q=9789510230763$/, { timeout: 10000 }).then(() => true, () => false), page.url());
    await page.goBack();
    await page.waitForURL(/\/evaluate$/);
    await page.getByRole("button", { name: "Stop camera" }).click().catch(() => {});
    const recent = page.getByRole("region", { name: "Recently evaluated" });
    await visible(recent);
    const list = (await recent.locator("li").allInnerTexts()).map((s) => s.replace(/\s+/g, " "));
    check("recently evaluated, with the catalogued title", list.length === 1 && list[0].includes("Pääkallokehrääjä") && list[0].includes("978-951023076-3"), JSON.stringify(list));
    check("recent list links to Antikvaari", (await recent.getByRole("link").first().getAttribute("href")) === "https://www.antikvaari.fi/hakukone?q=9789510230763");

    // Covered barcode: search by title.
    await page.getByLabel(/Search by title or author/).fill("Tuntematon sotilas");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    check("title search opens Antikvaari's search with the words", await page.waitForURL(/antikvaari\.fi\/hakukone\?q=Tuntematon%20sotilas$/, { timeout: 10000 }).then(() => true, () => false), page.url());
    await page.goBack();
    await page.waitForURL(/\/evaluate$/);
    check("back from a title search: scanning again", await visible(page.getByRole("button", { name: "Stop camera" })));
    await page.getByRole("button", { name: "Stop camera" }).click().catch(() => {});

    // Offline with auto-open on: the book is shown with a note instead.
    await page.context().setOffline(true);
    await page.getByLabel("Or type the ISBN").fill("9789510366868");
    await page.getByLabel("Or type the ISBN").press("Enter");
    check("offline: doesn't try to open Antikvaari", await visible(page.getByText(/No signal, so Antikvaari didn't open/)));
    await page.context().setOffline(false);
    check("Photo log linked", await visible(page.getByRole("link", { name: /Photo log/ })));
    await b.close();
  }
  await sleep(1000);
  check("nothing logged", sql("SELECT COUNT(*) n FROM copies")[0].n === copiesBefore);
  t.done();
})().catch(t.crash);
