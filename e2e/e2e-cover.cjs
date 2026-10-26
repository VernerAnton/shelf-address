// seed: places
// Cover photos (spec-corrections §15): the cover camera finds the book with
// OpenCV, the corners can be adjusted, the flattened cover is saved; covers
// taken by hand are never replaced by a lookup; offline they wait and upload.
const { suite, browser, phone, visible, gone, sql, sleep, choosePlace } = require("./lib.cjs");

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser("cover");
  const page = await phone(b, t);
  const recent = page.getByRole("region", { name: "Recent scans" });
  const edition = (isbn) => sql(`SELECT cover_url, cover_by_hand FROM editions WHERE isbn13 = '${isbn}'`)[0];
  const type = async (isbn) => {
    await page.getByLabel("Or type the ISBN").fill(isbn);
    await page.getByRole("button", { name: "Log", exact: true }).click();
  };

  await page.goto("/scan");
  await choosePlace(page, "Store", "Wall unit", "Row 2");
  await type("9789510366868");
  const row = recent.getByRole("listitem").filter({ hasText: "978-951036686-8" });
  check("not-found book offers a cover photo", await visible(row.getByRole("button", { name: "Photograph cover" }), 30000));
  check("…saying no cover was found", await visible(row.getByText("No cover found")));

  // Live camera: the book is found, photo taken, corners shown, saved.
  await row.getByRole("button", { name: "Photograph cover" }).click();
  const cam = page.getByRole("dialog", { name: /Photograph the cover of/ });
  check("cover camera opens", await visible(cam));
  check("finds the book in the picture", await visible(cam.getByText("Book found. Hold still and take the photo."), 60000));
  await cam.getByRole("button", { name: "Take photo" }).click();
  check("photo taken, with four corner handles", await visible(cam.getByRole("button", { name: /Top-left/ })) && (await cam.getByRole("button", { name: /Top-left|Top-right|Bottom-right|Bottom-left/ }).count()) === 4);
  // Nudge a corner with the keyboard (as a person could drag it).
  await cam.getByRole("button", { name: /Top-left/ }).focus();
  await page.keyboard.press("ArrowRight");
  await cam.getByRole("button", { name: "Save cover" }).click();
  check("saving closes the camera", await gone(cam, 30000));
  await sleep(2500);
  let e = edition("9789510366868");
  check("cover stored, marked as taken by hand", /^covers\//.test(e.cover_url || "") && e.cover_by_hand === 1, JSON.stringify(e));
  check("cover shown on the scan row", await visible(row.locator("img")));
  const img = await page.request.get("/" + e.cover_url);
  const bytes = await img.body();
  check("stored as a real JPEG", img.status() === 200 && bytes[0] === 0xff && bytes[1] === 0xd8, String(img.status()));
  const ratio = await page.evaluate(async (url) => { const i = new Image(); i.src = url; await i.decode(); return i.naturalHeight / i.naturalWidth; }, "/" + e.cover_url);
  check("flattened to the book's shape (portrait)", ratio > 1.15 && ratio < 1.6, String(ratio));

  // Looking it up again (the book page's "Try again") never replaces it.
  const id = sql("SELECT id FROM copies WHERE isbn13 = '9789510366868'")[0].id;
  await page.goto(`/copies/${id}`);
  check("book page says the cover is the person's", await visible(page.getByText("Cover photographed by you")));
  await page.getByRole("button", { name: "Try again" }).click();
  await sleep(4000);
  await page.reload();
  check("a later lookup leaves the hand-taken cover", edition("9789510366868").cover_url === e.cover_url);

  // Book page: a new photo replaces the old one (and removes the old file).
  await page.goto(`/copies/${id}`);
  check("book page offers to replace the cover", await visible(page.getByRole("button", { name: "Replace cover with a photo" })));
  await page.getByRole("button", { name: "Replace cover with a photo" }).click();
  await visible(cam.getByText("Book found. Hold still and take the photo."), 60000);
  await cam.getByRole("button", { name: "Take photo" }).click();
  await cam.getByRole("button", { name: "Save cover" }).click();
  await gone(cam, 30000);
  await sleep(2500);
  const replaced = edition("9789510366868").cover_url;
  check("book page: new cover replaces the old", replaced !== e.cover_url && /^covers\//.test(replaced));
  check("…old file removed", (await page.request.get("/" + e.cover_url)).status() === 404);

  // Offline: the cover waits on the phone and uploads later.
  await page.goto("/scan");
  await type("9789511234562");
  const row2 = recent.getByRole("listitem").filter({ hasText: "978-951123456-2" });
  await row2.getByRole("button", { name: "Photograph cover" }).waitFor({ timeout: 30000 });
  await page.context().setOffline(true);
  await row2.getByRole("button", { name: "Photograph cover" }).click();
  await visible(cam.getByText("Book found. Hold still and take the photo."), 60000);
  await cam.getByRole("button", { name: "Take photo" }).click();
  await cam.getByRole("button", { name: "Save cover" }).click();
  await gone(cam, 30000);
  check("offline: cover shown straight away", await visible(row2.locator("img")));
  check("…waiting to upload", await visible(page.getByText(/No signal\. 1 (change|scan) saved/)));
  check("…not on the server yet", !edition("9789511234562")?.cover_url);
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  check("back online: uploaded", await visible(page.getByText("Everything is saved."), 30000));
  await sleep(1500);
  check("…stored", edition("9789511234562")?.cover_by_hand === 1);

  // Choosing a photo instead of the camera.
  await page.goto(`/copies/${id}`);
  await page.getByRole("button", { name: "Replace cover with a photo" }).click();
  const photo = Buffer.from(await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 1600;
    const x = c.getContext("2d"); x.fillStyle = "#333"; x.fillRect(0, 0, 1200, 1600);
    x.fillStyle = "#c8553d"; x.fillRect(250, 250, 700, 1050); x.fillStyle = "#222"; x.fillRect(300, 350, 600, 120);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  }), "base64");
  await cam.getByLabel("Cover photo file").setInputFiles({ name: "cover.jpg", mimeType: "image/jpeg", buffer: photo });
  check("chosen photo: corners shown to adjust", await visible(cam.getByRole("button", { name: /Top-left/ }), 30000));
  await cam.getByRole("button", { name: "Save cover" }).click();
  check("…and saved", await gone(cam, 30000));

  await b.close();
  t.done();
})().catch(t.crash);
