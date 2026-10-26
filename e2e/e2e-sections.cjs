// seed: none
// Sections (spec §3, §5; spec-corrections §1–§3): building the tree of places,
// addresses and their warnings, editing, ordering, moving, deleting.
const { suite, browser, phone, visible, sql } = require("./lib.cjs");

const t = suite();
(async () => {
  const b = await browser();
  const page = await phone(b, t);
  const { check } = t;
  const save = (label) => page.getByRole("button", { name: label, exact: true }).click();
  // Only offered when there's a choice (inside a shelf, everything is a Section).
  const kind = async (k) => {
    const radio = page.getByRole("radio", { name: new RegExp("^" + k) });
    if (await radio.count()) await radio.check({ force: true });
  };
  const idOf = (label) => sql(`SELECT id FROM locations WHERE label = '${label}'`)[0]?.id;

  await page.goto("/sections");
  check("empty: says so", await visible(page.getByText("Nothing here yet")));
  check("empty: first site button", await visible(page.getByRole("link", { name: "Add your first site" })));

  // A site.
  await page.getByRole("link", { name: "Add your first site" }).click();
  await page.waitForURL(/\/sections\/new$/);
  check("new site: the three kinds offered, Site chosen", (await page.getByRole("radio").count()) === 3 && (await page.getByRole("radio", { name: /^Site/ }).isChecked()));
  await page.getByRole("textbox", { name: "Name" }).fill("Store");
  await save("Add");
  await page.waitForURL(/\/sections$/);
  check("site created, back on the list", await visible(page.getByRole("link", { name: /^Store Site/ })));
  await page.getByRole("link", { name: /^Store Site/ }).click();
  check("site page", await visible(page.getByRole("heading", { name: "Store", level: 1 })));
  const store = idOf("Store");

  // A shelf needs an address.
  await page.getByRole("link", { name: "Add inside" }).click();
  await page.waitForURL(/\/new\?parent=/);
  check("inside a site: shelf or section (no site)", (await page.getByRole("radio").count()) === 2);
  await kind("Shelf");
  await page.getByRole("textbox", { name: "Name" }).fill("Wall unit");
  check("shelf: address required", await page.getByRole("textbox", { name: /Address/ }).evaluate((el) => el.required));
  await page.getByRole("textbox", { name: /Address/ }).fill("Bulevard 1");
  await save("Add");
  await page.waitForURL((u) => !u.pathname.endsWith("/new"));
  check("listed with its address", await visible(page.getByRole("link", { name: /^Wall unit Bulevard 1 Shelf/ })));
  await page.getByRole("link", { name: /^Wall unit/ }).click();
  check("shelf shows its address with the site", await visible(page.getByText("Store — Bulevard 1")));
  const shelf = idOf("Wall unit");
  check("…stored with a normalised key", sql(`SELECT address_key FROM locations WHERE id='${shelf}'`)[0].address_key === "bulevard 1");

  // A section inside, no address: says which address it's inside.
  await page.getByRole("link", { name: "Add inside" }).click();
  await page.waitForURL(/\/new\?parent=/);
  await kind("Section");
  await page.getByRole("textbox", { name: "Name" }).fill("Row 2");
  await save("Add");
  await page.waitForURL((u) => !u.pathname.endsWith("/new"));
  await page.getByRole("link", { name: /^Row 2/ }).click();
  check("section without address: 'Inside Store — Bulevard 1'", await visible(page.getByText("Inside").filter({ hasText: "Store — Bulevard 1" })));
  check("section: scan and review buttons", await visible(page.getByRole("button", { name: "Scan books here" })) && await visible(page.getByRole("button", { name: "Review books here" })));

  // A second site with a shelf: same address → hard warning; similar → soft warning.
  await page.goto("/sections/new");
  await page.getByRole("textbox", { name: "Name" }).fill("Warehouse A");
  await save("Add");
  await page.waitForURL((u) => !u.pathname.endsWith("/new"));
  const wh = idOf("Warehouse A");
  await page.goto(`/sections/new?parent=${wh}`);
  await kind("Shelf");
  await page.getByRole("textbox", { name: "Name" }).fill("Back wall");
  await page.getByRole("textbox", { name: /Address/ }).fill("bulevard  1");
  await save("Add");
  check("same address: warns it's in use, and by whom", await visible(page.getByText(/is already in use/)) && await visible(page.getByText(/Store — Bulevard 1 \(shelf “Wall unit”\)/)));
  check("…nothing saved yet", !idOf("Back wall"));
  await page.getByRole("textbox", { name: /Address/ }).fill("Warehouse A Bulevard 1");
  await save("Add");
  check("similar address: soft warning", await visible(page.getByText("This looks like an address you already have")));
  await page.getByRole("button", { name: /It's different — save anyway/ }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/new"));
  check("…saved when confirmed", Boolean(idOf("Back wall")));
  check("'Bulevard 10' isn't similar to 'Bulevard 1'", await (async () => {
    await page.goto(`/sections/new?parent=${wh}`);
    await kind("Shelf");
    await page.getByRole("textbox", { name: "Name" }).fill("Corner");
    await page.getByRole("textbox", { name: /Address/ }).fill("Bulevard 10");
    await save("Add");
    await page.waitForURL((u) => !u.pathname.endsWith("/new"), { timeout: 10000 }).catch(() => {});
    return Boolean(idOf("Corner"));
  })());

  // Taking an address over leaves the old shelf without one.
  await page.goto(`/sections/${idOf("Corner")}/edit`);
  await page.getByRole("textbox", { name: /Address/ }).fill("Bulevard 1");
  await save("Save");
  await page.getByRole("button", { name: "Move address here" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/edit"));
  check("address moved to the new shelf", sql(`SELECT address FROM locations WHERE label='Corner'`)[0].address === "Bulevard 1");
  await page.goto(`/sections/${shelf}`);
  check("old shelf says it lost its address", await visible(page.getByText(/No address — this shelf lost it/)));
  await page.goto(`/sections/${shelf}/edit`);
  await page.getByRole("textbox", { name: /Address/ }).fill("Bulevard 2");
  await page.getByRole("textbox", { name: "Name" }).fill("Wall unit by the window");
  await save("Save");
  await page.waitForURL((u) => !u.pathname.endsWith("/edit"));
  check("edit: renamed and re-addressed", await visible(page.getByRole("heading", { name: "Wall unit by the window" })) && await visible(page.getByText("Store — Bulevard 2")));

  // Addresses A–Z.
  await page.goto("/sections/addresses");
  const main = page.locator("main");
  const rows = (await main.getByRole("listitem").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  check("A–Z lists every address, sorted, with site and place", rows.length === 3 && /^Bulevard 1\b/.test(rows[0]) && /^Bulevard 2\b/.test(rows[1]) && /Warehouse A Bulevard 1/.test(rows[2]), JSON.stringify(rows));
  await page.getByRole("searchbox", { name: /Filter/ }).fill("bulevard 2");
  await page.waitForTimeout(300);
  check("filter narrows it", (await main.getByRole("listitem").count()) === 1);

  // Order: custom order inside Warehouse A.
  await page.goto(`/sections/order?parent=${wh}`);
  const before = await page.locator("main").getByRole("listitem").filter({ has: page.getByRole("button") }).allInnerTexts();
  await page.getByRole("button", { name: /^Move Corner up/ }).click();
  await page.waitForTimeout(800);
  const after = await page.locator("main").getByRole("listitem").filter({ has: page.getByRole("button") }).allInnerTexts();
  check("reorder moves it up", before[0].includes("Back wall") && after[0].includes("Corner"), JSON.stringify([before, after]));
  check("…and says it's custom now", await visible(page.getByText(/Custom order/)));
  await page.goto(`/sections/${wh}`);
  check("place page follows the order", (await page.locator("main").getByRole("link", { name: /Shelf/ }).first().innerText()).includes("Corner"));

  // Move Row 2 into Warehouse A › Corner.
  const row = idOf("Row 2");
  await page.goto(`/sections/${row}/move`);
  check("move: starts where it is", await visible(page.getByText("It's already here.")));
  await page.getByRole("link", { name: "Top level" }).click();
  await page.getByRole("link", { name: /^Warehouse A/ }).click();
  await page.getByRole("link", { name: /^Corner/ }).click();
  await page.getByRole("button", { name: "Move into Corner" }).click();
  await page.waitForURL(new RegExp(`/sections/${row}$`));
  check("moved: now inside Corner", sql(`SELECT parent_id FROM locations WHERE id='${row}'`)[0].parent_id === idOf("Corner"));
  check("…and its 'inside' address follows", await visible(page.getByText("Inside").filter({ hasText: "Warehouse A — Bulevard 1" })));
  await page.goto(`/sections/${wh}/move`);
  check("sites don't move", await visible(page.getByText("Sites don't move")));

  // Delete: not while something's inside; then yes.
  await page.goto(`/sections/${idOf("Corner")}/edit`);
  check("can't delete with something inside", await visible(page.getByText(/empty it first — it has 1 place inside/)));
  await page.goto(`/sections/${row}/edit`);
  await page.getByRole("button", { name: "Delete “Row 2”" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  check("'Keep it' keeps it", Boolean(idOf("Row 2")));
  await page.getByRole("button", { name: "Delete “Row 2”" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/edit"));
  check("deleted", !idOf("Row 2"));
  check("…back on its parent", await visible(page.getByRole("heading", { name: "Corner" })));

  await page.goto("/sections");
  check("top level lists both sites", (await page.getByRole("link", { name: /Site ·/ }).count()) === 2);
  check("store id stable", Boolean(store));

  await b.close();
  t.done();
})().catch(t.crash);
