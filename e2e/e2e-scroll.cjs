// seed: shelves
// Long lists must scroll to their last item (spec-corrections V7 fix): the
// place picker with the store's real shelves, and Finna's search results.
const { suite, browser, phone, visible, sleep } = require("./lib.cjs");

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  // A short phone, so the lists are longer than the screen.
  const page = await phone(b, t, { viewport: { width: 360, height: 640 } });

  await page.goto("/scan");
  await page.getByRole("button", { name: "Choose" }).click();
  await page.getByRole("button", { name: "All places" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Store/ }).click();
  const items = page.getByRole("dialog").getByRole("listitem");
  await items.first().waitFor();
  const n = await items.count();
  check("the store's shelves are listed", n >= 10, String(n));
  const last = items.last();
  await last.scrollIntoViewIfNeeded();
  await sleep(300);
  const box = await last.boundingBox();
  check("the last shelf can be scrolled into view", box && box.y >= 0 && box.y + box.height <= 640 + 1, JSON.stringify(box));
  const lastName = (await last.innerText()).split("\n")[0].trim();
  await last.getByRole("button").first().click();
  const logHere = page.getByRole("button", { name: /^Log books at/ });
  if (await logHere.isVisible().catch(() => false)) await logHere.click();
  await page.getByRole("dialog").waitFor({ state: "detached" }).catch(() => {});
  check("…and chosen", await visible(page.getByRole("region", { name: "Where books are being logged" }).getByText(lastName).first()), lastName);

  // Finna results: twelve of them.
  await page.getByRole("button", { name: "No barcode? Find the book by title" }).click();
  const dialog = page.getByRole("dialog", { name: "Book without a barcode" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Sinuhe");
  await dialog.getByRole("button", { name: "Search Finna" }).click();
  const results = dialog.getByRole("list", { name: "Matching editions" }).getByRole("listitem");
  await results.first().waitFor();
  check("Finna results listed", (await results.count()) >= 10);
  const lastResult = results.last();
  await lastResult.scrollIntoViewIfNeeded();
  await sleep(300);
  const rb = await lastResult.boundingBox();
  check("the last result can be scrolled into view", rb && rb.y >= 0 && rb.y + rb.height <= 640 + 1, JSON.stringify(rb));
  check("…and isn't squashed", rb && rb.height >= 40, JSON.stringify(rb));

  await b.close();
  t.done();
})().catch(t.crash);
