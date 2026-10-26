// seed: places
// Instruction panels and site maps (spec-corrections §14): how to find a book
// on a shelf, shown on the shelf and everything inside it; a photo of the
// store's map per site.
const { suite, browser, phone, visible, sql } = require("./lib.cjs");

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  const page = await phone(b, t);

  // Instructions on a shelf.
  await page.goto("/sections/sh1");
  check("shelf: no instructions yet", await visible(page.getByText("No instructions yet for finding books here.")));
  await page.getByRole("button", { name: "Add instructions" }).click();
  const dialog = page.getByRole("dialog", { name: "Instructions for Wall unit" });
  check("editor opens", await visible(dialog));
  check("…with a note box for each part inside", await visible(dialog.getByRole("textbox", { name: "Row 2:" })));
  await dialog.getByRole("textbox", { name: "Row 2:" }).fill("Fiction, by publisher");
  await dialog.getByRole("textbox", { name: /How to find a book here/ }).fill("Someone wants a Otava novel — go to Row 2, it's grouped by publisher.");
  await dialog.getByRole("button", { name: "Save" }).click();
  check("editor closes", await page.getByRole("dialog").waitFor({ state: "detached" }).then(() => true, () => false));
  const card = page.getByRole("region", { name: "Instructions" });
  check("card shows how to find a book", await visible(card.getByText(/go to Row 2, it's grouped by publisher/)));
  check("…with when it was updated", await visible(card.getByText(/Updated|today|just now/i)));
  check("note shown on the part it's about", await visible(page.locator("main").getByText("Fiction, by publisher")));
  check("stored", sql("SELECT COUNT(*) n FROM panels")[0].n === 1);

  // Inside the shelf, the same guidance shows.
  await page.goto("/sections/r2");
  const inside = page.getByRole("region", { name: "Instructions" });
  check("part inside shows the shelf's guidance", await visible(inside.getByText(/grouped by publisher/)));
  check("…and its own note", await visible(inside.getByText("Fiction, by publisher")));

  // Editing it.
  await page.goto("/sections/sh1");
  await page.getByRole("region", { name: "Instructions" }).getByRole("button").first().click();
  await page.getByRole("dialog").getByRole("textbox", { name: /How to find a book here/ }).fill("Ask at the till first.");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  check("edited text shown", await visible(page.getByText("Ask at the till first.")));
  // Cancel keeps what was there.
  await page.getByRole("region", { name: "Instructions" }).getByRole("button").first().click();
  await page.getByRole("dialog").getByRole("textbox", { name: /How to find a book here/ }).fill("Something else");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).first().click();
  check("cancel keeps it", await visible(page.getByText("Ask at the till first.")));

  // A map for the site.
  await page.goto("/sections/s1");
  await page.getByRole("link", { name: "Add a map" }).click();
  await page.waitForURL(/\/sections\/s1\/map$/);
  check("map page: none yet", await visible(page.getByText(/No map yet/)));
  const photo = Buffer.from(await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 900;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = "#000"; x.lineWidth = 8; x.strokeRect(100, 100, 1000, 700);
    x.font = "60px sans-serif"; x.fillStyle = "#000"; x.fillText("A1   A2   B1", 300, 450);
    return c.toDataURL("image/jpeg", 0.85).split(",")[1];
  }), "base64");
  await page.getByLabel("Map photo").setInputFiles({ name: "map.jpg", mimeType: "image/jpeg", buffer: photo });
  const img = page.locator("main img");
  check("map shown after upload", await visible(img, 30000));
  check("…the stored image loads", await img.first().evaluate((el) => el.complete ? el.naturalWidth : new Promise((r) => { el.onload = () => r(el.naturalWidth); el.onerror = () => r(0); })) > 0);
  check("stored for the site", /^maps\/s1-\d+\.(jpg|webp|png)$/.test(sql("SELECT map_image_id k FROM locations WHERE id='s1'")[0].k || ""));
  await page.goto("/sections/r2");
  const mapLink = page.locator("main").getByRole("link", { name: /map/i });
  check("places inside the site link to the map", await visible(mapLink));
  await mapLink.first().click();
  check("…which opens it", await visible(page.locator("main img")));

  await b.close();
  t.done();
})().catch(t.crash);
