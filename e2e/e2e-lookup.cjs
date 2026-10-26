// seed: places
// Looking books up (spec §2.2; spec-corrections §9–§11): Finna → Google Books →
// Open Library, covers kept in R2, books not found, services down, books
// without a barcode (Finna search or by hand), the catalog.
const { suite, browser, phone, visible, sql, sleep, choosePlace, booksDown } = require("./lib.cjs");

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  const page = await phone(b, t);
  const recent = page.getByRole("region", { name: "Recent scans" });
  const rowFor = (text) => recent.getByRole("listitem").filter({ hasText: text });
  const edition = (isbn) => sql(`SELECT title, author, source, lookup_status, cover_url, needs_review FROM editions WHERE isbn13 = '${isbn}'`)[0];
  const copyId = (isbn) => sql(`SELECT id FROM copies WHERE isbn13 = '${isbn}' LIMIT 1`)[0]?.id;
  const type = async (isbn) => {
    await page.getByLabel("Or type the ISBN").fill(isbn);
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await sleep(300);
  };

  await page.goto("/scan");
  await choosePlace(page, "Store", "Wall unit", "Row 2");

  // Finna knows it, Google has the cover.
  await type("9780007156320");
  check("Finna title shown", await visible(rowFor("Manual of the warrior of light"), 30000));
  await sleep(1500);
  let e = edition("9780007156320");
  check("details from Finna", e.source === "finna" && e.author === "Paulo Coelho", JSON.stringify(e));
  check("cover from Google, kept in R2", /^covers\//.test(e.cover_url || ""), JSON.stringify(e));
  check("cover shown in the list", await visible(rowFor("Manual of the warrior of light").locator("img")));
  const cover = await page.request.get("/" + e.cover_url);
  check("…served from the app, not hotlinked", cover.status() === 200 && cover.headers()["content-type"] === "image/png");

  // Only Open Library knows it (Google rate-limited).
  await type("9780140328721");
  check("Open Library title shown", await visible(rowFor("Fantastic Mr. Fox"), 30000));
  e = edition("9780140328721");
  check("details from Open Library, author looked up", e.source === "open_library" && e.author === "Roald Dahl", JSON.stringify(e));

  // Nobody knows it.
  await type("9789510366868");
  check("not found: says so", await visible(rowFor("978-951036686-8").getByText(/Not found/), 30000));
  check("…stored as not found", edition("9789510366868").lookup_status === "not_found");

  // A service down: tried again later, not given up.
  await booksDown("9789511234562");
  await type("9789511234562");
  await sleep(3000);
  check("service down: kept for a retry", edition("9789511234562").lookup_status !== "not_found", JSON.stringify(edition("9789511234562")));
  await booksDown("9789511234562", false);

  // Book page of a book nobody knew: try again, or enter by hand.
  await page.goto(`/copies/${copyId("9789510366868")}`);
  check("book page: not found, with what to do", await visible(page.getByText("Not found in Finna, Google Books or Open Library.")) && await visible(page.getByRole("button", { name: "Enter details by hand" })));
  await page.getByRole("button", { name: "Enter details by hand" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Käsin korjattu kirja");
  await page.getByRole("textbox", { name: "Author" }).fill("Testi Kirjailija");
  await page.getByRole("button", { name: /^Save/ }).click();
  check("hand-entered details shown", await visible(page.getByRole("heading", { name: "Käsin korjattu kirja" })));
  e = edition("9789510366868");
  check("…stored as entered by hand", e.title === "Käsin korjattu kirja" && e.source === "manual", JSON.stringify(e));

  // No barcode: find it on Finna by title.
  await page.goto("/scan");
  await page.getByRole("button", { name: "No barcode? Find the book by title" }).click();
  const dialog = page.getByRole("dialog", { name: "Book without a barcode" });
  check("search waits for a title", await dialog.getByRole("button", { name: "Search Finna" }).isDisabled());
  await dialog.getByRole("textbox", { name: "Title" }).fill("Sinuhe");
  await dialog.getByRole("button", { name: "Search Finna" }).click();
  const results = dialog.getByRole("list", { name: "Matching editions" });
  check("Finna editions listed, with year and publisher", await visible(results.getByRole("button", { name: /Sinuhe egyptiläinen Mika Waltari · 1946 · WSOY/ })));
  await results.getByRole("button", { name: /Sinuhe egyptiläinen Mika Waltari · 1946 · WSOY/ }).click();
  check("chosen edition logged", await visible(page.getByText("Logged Sinuhe egyptiläinen")));
  await sleep(1500);
  const finnaKey = sql("SELECT isbn13 FROM copies WHERE isbn13 LIKE 'finna:%'")[0]?.isbn13;
  check("…logged by its Finna record", Boolean(finnaKey), finnaKey);
  check("…with Finna's details, not for review", edition(finnaKey).source === "finna" && edition(finnaKey).needs_review === 0, JSON.stringify(edition(finnaKey)));

  // No barcode, not on Finna: by hand, marked for review.
  await page.getByRole("button", { name: "No barcode? Find the book by title" }).click();
  await dialog.getByRole("button", { name: "Not listed? Enter it by hand" }).click();
  check("by hand: says it'll need review", await visible(dialog.getByText(/marked “needs review”/)));
  await dialog.getByRole("textbox", { name: "Title" }).fill("Kotikutoinen runokirja");
  await dialog.getByRole("textbox", { name: "Author" }).fill("Tuntematon");
  await dialog.getByRole("textbox", { name: "Year (optional)" }).fill("1938");
  await dialog.getByRole("button", { name: "Use these details" }).click();
  check("hand-entered book logged", await visible(page.getByText("Logged Kotikutoinen runokirja")));
  await sleep(1500);
  const manual = sql("SELECT e.* FROM editions e WHERE title = 'Kotikutoinen runokirja'")[0];
  check("…flagged needs review", manual && manual.needs_review === 1 && manual.year === 1938 && manual.source === "manual", JSON.stringify(manual));

  // Catalog.
  await page.goto("/catalog");
  check("catalog counts", await visible(page.getByText(/\d+ copies of \d+ books logged/)));
  await page.getByRole("searchbox", { name: "Search books" }).fill("dahl");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  check("search by author finds it, with where it is", await visible(page.getByRole("list", { name: "Copies of Fantastic Mr. Fox" }).getByRole("link", { name: /Store — Bulevard 1/ })));
  await page.getByRole("searchbox", { name: "Search books" }).fill("978-0-00-715632-0");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  check("search by ISBN with dashes finds it", await visible(page.getByText("Manual of the warrior of light")));
  await page.goto("/catalog?review=1");
  check("needs-review list has the hand-entered book", await visible(page.getByText("Kotikutoinen runokirja")));

  await b.close();
  t.done();
})().catch(t.crash);
