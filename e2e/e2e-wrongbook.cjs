// seed: places
// A book's own page (spec-corrections §10–§12): the wrong book behind a
// barcode, condition, moving a copy, removing it.
const { suite, browser, phone, visible, sql, sleep, choosePlace } = require("./lib.cjs");

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  const page = await phone(b, t);
  const copy = (id) => sql(`SELECT isbn13, location_id, condition FROM copies WHERE id = '${id}'`)[0];

  // Two copies of the same barcode.
  await page.goto("/scan");
  await choosePlace(page, "Store", "Wall unit", "Row 2");
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Or type the ISBN").fill("9789510230763");
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await sleep(600);
  }
  await sleep(3000);
  const [first, second] = sql("SELECT id FROM copies ORDER BY added_at").map((r) => r.id);

  // Wrong book, fixed with the ISBN printed inside.
  await page.goto(`/copies/${first}`);
  check("book page shows the barcode's book", await visible(page.getByRole("heading", { name: "Pääkallokehrääjä" })));
  await page.getByRole("button", { name: "Wrong book? Pick the right one" }).click();
  const dialog = page.getByRole("dialog", { name: "Which book is this really?" });
  check("asks which book it really is, naming the barcode's", await visible(dialog.getByText(/Its barcode says Pääkallokehrääjä/)));
  await dialog.getByRole("textbox", { name: /ISBN printed inside the book/ }).fill("9780007156320");
  await dialog.getByRole("button", { name: "Use" }).click();
  check("asks to confirm the change", await visible(page.getByText("Change this copy to 978-000715632-0?")));
  await page.getByRole("button", { name: "Change", exact: true }).click();
  // Its details are looked up after the change; the page has them on a reload.
  let shown = false;
  for (let i = 0; i < 10 && !shown; i++) {
    await sleep(1500);
    await page.reload();
    shown = await visible(page.getByRole("heading", { name: "Manual of the warrior of light" }), 2000);
  }
  check("now shows the right book", shown);
  check("this copy changed", copy(first).isbn13 === "9780007156320");
  check("the other copy of the barcode didn't", copy(second).isbn13 === "9789510230763");

  // Wrong book, fixed by searching Finna.
  await page.goto(`/copies/${second}`);
  await page.getByRole("button", { name: "Wrong book? Pick the right one" }).click();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Sinuhe");
  await dialog.getByRole("button", { name: "Search Finna" }).click();
  await dialog.getByRole("button", { name: /Sinuhe egyptiläinen Mika Waltari · 1946 · WSOY/ }).click();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  check("Finna edition chosen", await visible(page.getByRole("heading", { name: "Sinuhe egyptiläinen" }), 30000));
  check("…copy now that Finna record", /^finna:/.test(copy(second).isbn13), copy(second).isbn13);

  // Condition on the book page: set, then tap again to clear.
  const k4 = page.getByRole("group", { name: "Condition" }).getByRole("button", { name: "K4" });
  await k4.click();
  await sleep(1500);
  check("condition set", copy(second).condition === "K4" && (await k4.getAttribute("aria-pressed")) === "true");
  await k4.click();
  await sleep(1500);
  check("tap again clears it", copy(second).condition === null);

  // Move it.
  await page.getByRole("link", { name: "Move to another place" }).click();
  check("move starts where it is", await visible(page.getByText("It's already here.")));
  await page.getByRole("link", { name: "Top level" }).click();
  await page.getByRole("link", { name: /^Warehouse A/ }).click();
  await page.getByRole("link", { name: /^Box 3/ }).click();
  await page.getByRole("button", { name: "Move into Box 3" }).click();
  await page.waitForURL(new RegExp(`/copies/${second}$`));
  check("moved", copy(second).location_id === "b1");
  check("page says where it is now", await visible(page.getByText("Box 3").first()));

  // Remove it.
  await page.getByRole("button", { name: "Remove this book" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  check("'Keep it' keeps it", Boolean(copy(second)));
  await page.getByRole("button", { name: "Remove this book" }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/copies/"));
  check("removed", !copy(second));
  check("…back on its place", /\/sections\/b1$/.test(page.url()), page.url());

  await b.close();
  t.done();
})().catch(t.crash);
