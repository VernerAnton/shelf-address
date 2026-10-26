// seed: places
// Review mode (spec-corrections §16): check a place against what's logged
// there. Counts per book; not-found copies are removed (sold) or left pending
// (marked missing); a missing copy scanned elsewhere asks "is this that copy?".
const { suite, browser, phone, visible, sql, sleep, choosePlace } = require("./lib.cjs");

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  const page = await phone(b, t);
  const add = (key, loc) => page.request.post("/api/copies", { data: { id: crypto.randomUUID(), editionKey: key, locationId: loc, scannedAt: new Date().toISOString() } });
  const type = async (isbn) => {
    await page.getByLabel("Or type the ISBN").fill(isbn);
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await sleep(700);
  };
  const copies = () => sql("SELECT isbn13, location_id, missing_since FROM copies ORDER BY isbn13, location_id");

  // Logged at Row 2: two copies of Pääkallokehrääjä, one Coelho. Elsewhere: Dahl in Box 3.
  await page.goto("/scan");
  for (const [k, l] of [["9789510230763", "r2"], ["9789510230763", "r2"], ["9780007156320", "r2"], ["9780140328721", "b1"]]) await add(k, l);
  await sleep(3000);

  // Start from the place page.
  await page.goto("/sections/r2");
  await page.getByRole("button", { name: "Review books here" }).click();
  await page.waitForURL(/\/scan$/);
  const panel = page.getByRole("region", { name: "Review in progress" });
  check("review starts from the place page", await visible(panel.getByText("Row 2 · Store — Bulevard 1")));
  check("counts what's logged there", await visible(panel.getByText("0 of 3 found")));
  check("lists what's not scanned yet", await visible(page.getByText("Not scanned yet (3)")));

  await type("9789510230763"); // one of the two
  await type("9780140328721"); // logged elsewhere: added here as another copy
  await type("9789510366868"); // never logged: added
  check("counter: 1 found, 2 added", await visible(panel.getByText("1 of 3 found · 2 added")));
  const scanned = page.getByRole("region", { name: "Scanned in this review" });
  check("scanned list says what each was", await visible(scanned.getByRole("listitem").filter({ hasText: "Pääkallokehrääjä" }).getByText("Was here")) && await visible(scanned.getByRole("listitem").filter({ hasText: "978-951036686-8" }).getByText("Added here")));
  await scanned.getByRole("listitem").filter({ hasText: "978-951036686-8" }).getByRole("button", { name: "Undo" }).click();
  check("undo takes a scan back", await visible(panel.getByText("1 of 3 found · 1 added")));
  await type("9789510366868");

  // Survives closing the app.
  await page.reload();
  check("review kept on the phone across a reload", await visible(panel.getByText("1 of 3 found · 2 added")));
  check("nothing changed on the server mid-review", sql("SELECT COUNT(*) n FROM copies")[0].n === 4);

  // Finish.
  await panel.getByRole("button", { name: "Finish review" }).click();
  const dialog = page.getByRole("dialog", { name: /Finish reviewing Row 2/ });
  check("totals shown", (await dialog.getByRole("list", { name: "Review totals" }).innerText()).replace(/\s+/g, " ").includes("1 found 2 added 0 address changed"));
  const notFound = dialog.getByRole("region", { name: "Not found" });
  check("two not found, pending by default", await visible(notFound.getByRole("heading", { name: "Not found (2)" })) && (await notFound.getByRole("radio", { name: "Leave pending", checked: true }).count()) === 2);
  await notFound.getByRole("radiogroup", { name: /Manual of the warrior of light/ }).getByRole("radio", { name: "Remove (sold)" }).check({ force: true });
  await dialog.getByRole("button", { name: "Save review" }).click();
  check("summary after saving", await visible(page.getByText(/1 found, 2 added, 1 removed, 1 pending\./), 20000));
  await sleep(2500);
  const rows = copies();
  check("sold copy removed", !rows.some((r) => r.isbn13 === "9780007156320"), JSON.stringify(rows));
  check("one Pääkallokehrääjä marked missing, the other not", rows.filter((r) => r.isbn13 === "9789510230763" && r.missing_since).length === 1 && rows.filter((r) => r.isbn13 === "9789510230763").length === 2);
  check("added copies stored here", rows.filter((r) => r.location_id === "r2" && ["9780140328721", "9789510366868"].includes(r.isbn13)).length === 2);
  check("Dahl in Box 3 untouched", rows.some((r) => r.isbn13 === "9780140328721" && r.location_id === "b1"));
  check("place's review date stored", Boolean(sql("SELECT reviewed_at FROM locations WHERE id='r2'")[0].reviewed_at));
  await page.goto("/sections/r2");
  check("place page: last reviewed", await visible(page.getByText(/Last reviewed/)));
  check("place page: missing copy marked", await visible(page.getByText(/Not found in review ·/).first()));

  // The missing copy turns up in Box 3.
  await page.goto("/scan");
  await choosePlace(page, "Warehouse A", "Box 3");
  await type("9789510230763");
  const row = page.getByRole("region", { name: "Recent scans" }).getByRole("listitem").filter({ hasText: "978-951023076-3" });
  check("asks: is this the copy missing from Row 2?", await visible(row.getByText(/missing from Row 2 · Store — Bulevard 1/)));
  await row.getByRole("button", { name: "Yes — change its address to here" }).click();
  await sleep(2500);
  const after = copies().filter((r) => r.isbn13 === "9789510230763");
  check("yes: the missing copy's address changes, no extra copy", after.length === 2 && after.some((r) => r.location_id === "b1" && !r.missing_since) && !after.some((r) => r.missing_since), JSON.stringify(after));

  // Cancel a review: nothing kept.
  await page.getByRole("button", { name: /^Review Box 3/ }).click();
  await visible(page.getByRole("region", { name: "Review in progress" }).getByText("0 of 2 found"));
  await type("9789510366868");
  await page.getByRole("region", { name: "Review in progress" }).getByRole("button", { name: "Cancel" }).click();
  const stop = page.getByRole("button", { name: /Stop|Yes|Cancel review/ }).filter({ hasNotText: "Keep" });
  if (await stop.count()) await stop.last().click();
  check("cancelled review: back to normal scanning", await visible(page.getByRole("region", { name: "Where books are being logged" })));
  await sleep(1500);
  check("…and nothing saved from it", copies().filter((r) => r.location_id === "b1").length === 2);

  await b.close();
  t.done();
})().catch(t.crash);
