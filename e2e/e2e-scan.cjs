// seed: places
// Scan (spec §6, §7; spec-corrections §4–§8): logging books into a place with
// the camera or by typing, condition, undo, the offline queue.
const { suite, browser, phone, visible, sql, sleep, choosePlace } = require("./lib.cjs");

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser("book");
  const page = await phone(b, t);
  const recent = page.getByRole("region", { name: "Recent scans" });
  const rowFor = (isbn) => recent.getByRole("listitem").filter({ hasText: isbn });
  const copies = () => sql("SELECT isbn13, location_id, condition FROM copies ORDER BY added_at");
  const type = async (isbn) => {
    await page.getByLabel("Or type the ISBN").fill(isbn);
    await page.getByRole("button", { name: "Log", exact: true }).click();
  };

  await page.goto("/scan");
  check("scanning waits for a place", await page.getByRole("button", { name: "Scan with camera" }).isDisabled());
  check("…and typing too", await page.getByLabel("Or type the ISBN").isDisabled());
  await choosePlace(page, "Store", "Wall unit", "Row 2");
  check("active place shown with its address", await visible(page.getByText("Store — Bulevard 1")) && await visible(page.getByRole("region", { name: "Where books are being logged" }).getByText("Row 2")));

  // Camera.
  await page.getByRole("button", { name: "Scan with camera" }).click();
  check("camera reads a real EAN-13 book barcode", await visible(page.getByText("Logged 978-951036686-8"), 20000));
  await sleep(4000);
  check("held in view: logged once, not over and over", (await recent.getByRole("listitem").count()) === 1);
  check("uploaded", await visible(page.getByText("Everything is saved.")));
  await page.getByRole("button", { name: "Stop camera" }).click();
  let rows = copies();
  check("stored at the chosen place", rows.length === 1 && rows[0].isbn13 === "9789510366868" && rows[0].location_id === "r2", JSON.stringify(rows));
  check("unknown book: says so", await visible(rowFor("978-951036686-8").getByText(/Not found/), 20000));

  // Typing, ISBN-10 converted; a known book gets its title.
  await type("9510230766");
  check("ISBN-10 converted, and says so", await visible(page.getByText(/Read as 9789510230763 \(converted from the 10-digit ISBN\)/)));
  check("typed ISBN logged", await visible(rowFor("978-951023076-3")));
  check("title looked up (Finna)", await visible(rowFor("978-951023076-3").getByText("Pääkallokehrääjä"), 30000));
  await type("9789510230760");
  check("wrong check digit refused", await visible(page.getByText(/last digit doesn't check out/)));
  await type("9771234567003");
  check("non-book barcode refused", await visible(page.getByText(/not a book barcode/)));

  // Condition and undo.
  await rowFor("978-951023076-3").getByRole("button", { name: "K3" }).click();
  check("condition chip marked", (await rowFor("978-951023076-3").getByRole("button", { name: "K3" }).getAttribute("aria-pressed")) === "true");
  await sleep(2500);
  check("condition stored", copies().find((r) => r.isbn13 === "9789510230763")?.condition === "K3", JSON.stringify(copies()));
  await rowFor("978-951036686-8").getByRole("button", { name: "Undo" }).click();
  await sleep(2500);
  check("undo removes it from the list", (await rowFor("978-951036686-8").count()) === 0);
  check("…and from the server", !copies().some((r) => r.isbn13 === "9789510366868"));

  // Kept on the phone across a reload.
  await page.reload();
  check("recent scans kept on the phone", await visible(rowFor("978-951023076-3")));

  // Offline: saved on the phone, uploaded later.
  const before = copies().length;
  await page.context().setOffline(true);
  await choosePlace(page, "Warehouse A", "Box 3");
  check("place picker works offline", await visible(page.getByRole("region", { name: "Where books are being logged" }).getByText("Box 3")));
  await type("9780306406157");
  await type("9780804429573");
  check("offline banner counts what's waiting", await visible(page.getByText(/No signal\. 2 (scans|changes) saved on this phone/)));
  await rowFor("978-080442957-3").getByRole("button", { name: "K2" }).click();
  await rowFor("978-030640615-7").getByRole("button", { name: "Undo" }).click();
  check("offline undo just drops it", await visible(page.getByText(/No signal\. 2 (scans|changes) saved/)) || await visible(page.getByText(/No signal\. 1 (scan|change) saved/)));
  await sleep(1500);
  check("nothing reached the server while offline", copies().length === before);
  check("list is headed by the current place", await visible(page.getByRole("heading", { name: "Scanned into Box 3" })));
  check("earlier place's scans tucked under 'other places'", await visible(page.getByText(/Recent scans in other places \(1\)/)));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  check("back online: uploads", await visible(page.getByText("Everything is saved."), 20000));
  await sleep(1500);
  rows = copies();
  const offline = rows.find((r) => r.isbn13 === "9780804429573");
  check("offline scan stored with its place and condition", offline && offline.location_id === "b1" && offline.condition === "K2", JSON.stringify(rows));
  check("offline undo never reached the server", !rows.some((r) => r.isbn13 === "9780306406157"));

  // "Scan books here" from a place page.
  await page.goto("/sections/r2");
  await page.getByRole("button", { name: "Scan books here" }).click();
  await page.waitForURL(/\/scan$/);
  check("'Scan books here' sets the place", await visible(page.getByRole("region", { name: "Where books are being logged" }).getByText("Row 2")));
  check("place page lists its books", await (async () => {
    await page.goto("/sections/r2");
    return visible(page.getByText("Pääkallokehrääjä"));
  })());

  // A book's own page.
  const id = sql("SELECT id FROM copies WHERE isbn13 = '9789510230763'")[0].id;
  await page.goto(`/copies/${id}`);
  check("book page: title, condition, where it is", await visible(page.getByRole("heading", { name: "Pääkallokehrääjä" })) && await visible(page.getByText("K3").first()) && await visible(page.getByText(/Bulevard 1/).first()));

  await b.close();
  t.done();
})().catch(t.crash);
