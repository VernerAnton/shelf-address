// seed: none
// BookOps (spec-corrections §27): the Extract tab's two options; on a computer,
// one screen — queue, book, camera. Front and back cover photographed (Space),
// ISBN from the barcode, title and author from the book databases, back-cover
// text from the AI (stand-ins here), each field saying where its text came
// from and none overwriting what was typed; price and condition by hand; four
// price-check links; sent to the web store (a stand-in); a phone as the camera.
const { suite, browser, phone, visible, gone, sleep, sql, BASE_URL, BOOKS } = require("./lib.cjs");

const ai = (query) => fetch(`${BOOKS}/__ai${query ? `?${query}` : ""}`, { method: query ? "POST" : "GET" }).then((r) => r.json());
const AI_TEXT = "Väinö Linnan romaani kertoo suomalaisesta konekiväärikomppaniasta jatkosodassa.\n\nTeos on myyty yli miljoona kappaletta.";
const rows = () => sql("SELECT * FROM bookops_books ORDER BY created_at");
const until = async (fn, ms = 25000) => {
  for (const end = Date.now() + ms; ; ) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await sleep(400);
  }
};
// A photo of a cover with some words on it and no barcode.
const cover = (page, lines, colour) => page.evaluate(([lines, colour]) => {
  const c = document.createElement("canvas"); c.width = 1500; c.height = 2000;
  const x = c.getContext("2d"); x.fillStyle = colour; x.fillRect(0, 0, 1500, 2000);
  x.fillStyle = "#f3eee2"; x.font = "72px Georgia, serif";
  lines.forEach((l, i) => x.fillText(l, 150, 400 + i * 120));
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, [lines, colour]).then((b64) => ({ name: "IMG.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") }));
const logIn = async (page) => {
  const form = page.getByRole("form", { name: "AI reading login" });
  await form.getByLabel(/access code/).fill("test-code");
  await form.getByRole("button", { name: "Log in" }).click();
};

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser("book"); // the camera shows a book's barcode: 9789510366868, which no stand-in database knows
  const page = await phone(b, t);
  const pcCtx = await b.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 950 }, permissions: ["camera"] });
  await pcCtx.route(/^https:\/\/www\.(antikvaari\.fi|adlibris\.com|suomalainen\.com|akateeminen\.com)\//, (r) => r.fulfill({ contentType: "text/html", body: "<title>shop stand-in</title>" }));
  const pc = await pcCtx.newPage();
  pc.setDefaultTimeout(20000);
  pc.on("pageerror", (e) => t.errors.push(String(e)));
  const labels = (nav) => nav.getByRole("link").allInnerTexts().then((x) => x.map((s) => s.trim()).join(","));
  const current = (nav) => nav.locator("[aria-current=page]").allInnerTexts().then((x) => x.map((s) => s.trim()).join(","));

  // The Extract tab: two options, and it still opens Text Extract.
  const main = page.getByRole("navigation", { name: "Main" });
  const sub = page.getByRole("navigation", { name: "Extract" });
  await page.goto("/evaluate");
  check("phone: no Extract row outside Extract", (await sub.count()) === 0);
  await main.getByRole("link", { name: "Extract" }).click();
  await page.waitForURL(/\/extract$/);
  check("phone: the Extract tab still opens Text Extract (the camera)", await visible(page.getByRole("heading", { name: "Extract" })));
  check("phone: Extract row — BookOps left, Text Extract right", (await labels(sub)) === "BookOps,Text Extract", await labels(sub).catch(() => ""));
  check("phone: Text Extract marked", (await current(sub)) === "Text Extract" && (await current(main)) === "Extract");
  check("the Extract row sits just above the main row", await page.evaluate(() => {
    const s = document.querySelector("nav[aria-label=Extract]").getBoundingClientRect();
    const m = document.querySelector("nav[aria-label=Main]").getBoundingClientRect();
    return s.bottom <= m.top + 1 && m.top - s.bottom < 4 && s.height >= 44;
  }));
  await sub.getByRole("link", { name: "BookOps" }).click();
  await page.waitForURL(/\/extract\/bookops$/);
  check("phone: BookOps opens from the row, marked", await visible(page.getByRole("heading", { name: "BookOps" })) && (await current(sub)) === "BookOps" && (await current(main)) === "Extract");
  await page.goto("/extract/saved");
  check("Saved texts counts as Text Extract", (await current(sub)) === "Text Extract");

  const pcMain = pc.getByRole("navigation", { name: "Main" });
  const pcSub = pc.getByRole("navigation", { name: "Extract" });
  await pc.goto("/");
  check("computer: the app still opens on Saved texts", await pc.waitForURL(/\/extract\/saved$/).then(() => true, () => false), pc.url());
  await pcMain.getByRole("link", { name: "Extract" }).click();
  await pc.waitForURL(/\/extract\/saved$/);
  check("computer: the Extract tab still goes to Saved texts, Text Extract marked", (await current(pcSub)) === "Text Extract");
  await pcSub.getByRole("link", { name: "BookOps" }).click();
  await pc.waitForURL(/\/extract\/bookops$/);
  check("computer: BookOps opens from the row", await visible(pc.getByRole("heading", { name: "BookOps" })) && (await current(pcSub)) === "BookOps");

  // Behind the access code, like Saved texts.
  check("computer: asks for the access code", await visible(pc.getByRole("form", { name: "AI reading login" }).getByText("BookOps needs the access code")));
  const refused = await pc.request.get("/api/extract/bookops/books");
  check("the books can't be read without the code", refused.status() === 401 && (await refused.json()).kind === "login");
  check("…nor a photo", (await pc.request.get("/api/extract/bookops/photos/x-front-1.jpg")).status() === 401);
  check("…nor a book added", (await pc.request.post("/api/extract/bookops/books", { multipart: { id: "12345678", isbn: "9789510230763", isbnSource: "typed" } })).status() === 401 && rows().length === 0);
  await logIn(pc);
  const camera = pc.getByRole("region", { name: "Camera" });
  const queue = pc.locator("[aria-label='Queue']");
  const bookBox = pc.getByRole("region", { name: "Book", exact: true });
  const lastBook = pc.getByRole("status", { name: "Last book" });
  const saving = pc.getByRole("status", { name: "Saving" });
  const step = () => camera.locator("[aria-current=step]").innerText().then((s) => s.replace(/\s+/g, " ").trim());
  check("logged in: empty queue explained", await visible(queue.getByText(/Nothing in the queue/)));
  check("the camera starts by itself", await visible(camera.getByText("LIVE")));

  // Stop camera: off, stays off on the next visit, until started again.
  const cameraOn = () => pc.evaluate(() => Boolean(document.querySelector("video[aria-label='Camera picture']")?.srcObject?.getVideoTracks().some((tr) => tr.readyState === "live")));
  check("camera is running", await cameraOn());
  await camera.getByRole("button", { name: "Stop camera" }).click();
  check("Stop camera: off, the camera let go", await visible(camera.getByRole("status", { name: "Camera off" }).getByText("The camera is off.")) && !(await cameraOn()) && (await camera.getByText("LIVE").count()) === 0);
  check("…Take picture can't be pressed, no Stop button", await camera.getByRole("button", { name: /Take picture/ }).isDisabled() && (await camera.getByRole("button", { name: "Stop camera" }).count()) === 0);
  await pc.getByRole("heading", { name: "BookOps" }).click();
  await pc.keyboard.press("Space");
  await sleep(600);
  check("…Space takes nothing", /Step 1 Front cover/.test(await camera.locator("[aria-current=step]").innerText().then((s) => s.replace(/\s+/g, " "))));
  await pc.reload();
  check("stopped stays stopped when BookOps is opened again", await visible(camera.getByRole("button", { name: "Start camera" })) && !(await cameraOn()));
  await camera.getByRole("button", { name: "Start camera" }).click();
  check("Start camera: live again", await visible(camera.getByText("LIVE")) && await cameraOn() && await visible(camera.getByRole("button", { name: "Stop camera" })));
  await pc.reload();
  check("…and starts by itself again on the next visit", await visible(camera.getByText("LIVE")));
  check("three columns: queue, book, camera", await pc.evaluate(() => {
    const q = document.querySelector("[aria-label=Queue]").getBoundingClientRect();
    const c = document.querySelector("section[aria-label=Camera]").getBoundingClientRect();
    return q.right < c.left && c.left > innerWidth / 2 && Math.abs(q.top - c.top) < 40;
  }));
  check("says the web store connection is a test", await visible(pc.getByText(/test connection to the web store/)));

  // Space takes the picture — but not while typing.
  const isbnBox = pc.getByRole("form", { name: "Add by ISBN" }).getByLabel("ISBN");
  await isbnBox.click();
  await pc.keyboard.press("Space");
  await sleep(700);
  check("Space while typing takes no picture", /Step 1 Front cover/.test(await step()) && (await isbnBox.inputValue()) === " ", await step());
  await isbnBox.fill("");
  await pc.getByRole("heading", { name: "BookOps" }).click();
  await pc.keyboard.press("Space");
  check("Space: front cover taken, now the back", await until(async () => /Step 2 Back cover/.test(await step())), await step());
  check("…the photos can be retaken", await visible(camera.getByRole("button", { name: "Retake" })));
  check("nothing stored yet", rows().length === 0);
  await pc.keyboard.press("Space");
  check("Space again: the book is added, ISBN from the barcode", await visible(lastBook.getByText(/Added to the queue\. ISBN 978-951036686-8 read from the barcode/), 30000));
  check("the camera is ready for the next book at once", /Step 1 Front cover/.test(await step()));
  let book = await until(() => { const r = rows()[0]; return r && r.ai_status !== "pending" && r.lookup_status !== "pending" ? r : null; });
  check("stored: ISBN from the barcode, both photos", book && book.isbn13 === "9789510366868" && book.isbn_source === "barcode" && /^bookops\/.+-front-\d+\.jpg$/.test(book.front_photo) && /^bookops\/.+-back-\d+\.jpg$/.test(book.back_photo), JSON.stringify(book));
  const asked = (await ai()).requests.at(-1);
  check("the AI was sent both photos, as BookOps", asked && asked.title === "Shelf-Address BookOps" && asked.images === 2 && /"description"/.test(asked.prompt) && /Never make one up/.test(asked.prompt), JSON.stringify(asked));
  check("no database knew the ISBN: title and author from the AI, marked", book.lookup_status === "not_found" && book.title === "Tuntematon sotilas" && book.title_source === "ai" && book.author_source === "ai");
  check("back-cover text from the AI", book.description === AI_TEXT && book.description_source === "ai");
  check("screen: the book is open, title filled in", await until(async () => (await bookBox.getByLabel("Title", { exact: true }).inputValue()) === "Tuntematon sotilas"));
  check("…marked 'AI read it · check'", (await bookBox.getByText("AI read it · check").count()) === 2);
  check("…the text is there, marked as read by the AI", (await bookBox.getByLabel("Description").inputValue()) === AI_TEXT && await visible(bookBox.getByText("AI read the back cover")));
  check("…ISBN shown with where it came from", await visible(bookBox.getByText(/ISBN 978-951036686-8 · from the barcode/)) && await visible(bookBox.getByText(/not in the book databases/)));
  check("queue: To price, and Check", await visible(queue.getByRole("button", { name: /To price.*Check.*Tuntematon sotilas/s })));
  const photos = pc.getByRole("region", { name: "Photos of this book" });
  check("both photos shown", await until(() => photos.locator("img").evaluateAll((imgs) => imgs.length === 2 && imgs.every((i) => i.complete && i.naturalWidth > 0))));
  check("no price suggested", (await bookBox.getByLabel("Price €").inputValue()) === "" && book.price_cents === null);

  // The price check: four links, the ISBN filled in.
  const links = await pc.getByRole("navigation", { name: "Price check" }).getByRole("link").evaluateAll((as) => as.map((a) => [a.innerText.split("\n")[0].replace("↗", "").trim(), a.href, a.target]));
  check("price check: Antikvaari.fi, Adlibris, Suomalainen, Akateeminen — each its own new tab", JSON.stringify(links) === JSON.stringify([
    ["Antikvaari.fi", "https://www.antikvaari.fi/hakukone?q=9789510366868", "_blank"],
    ["Adlibris", "https://www.adlibris.com/fi/haku?q=9789510366868", "_blank"],
    ["Suomalainen", "https://www.suomalainen.com/search?q=9789510366868", "_blank"],
    ["Akateeminen", "https://www.akateeminen.com/search?q=9789510366868", "_blank"],
  ]), JSON.stringify(links));

  // Sending needs a price and a condition.
  await pc.getByRole("button", { name: "Send to web store" }).click();
  check("can't be sent without a price and a condition", await visible(saving.getByText("Add a price and a condition first.")) && rows()[0].status === "draft");
  await bookBox.getByLabel("Price €").fill("12,5");
  check("the price saves by itself", await visible(saving.getByText("✓ Saved")) && rows()[0].price_cents === 1250);
  await bookBox.getByLabel("Price €").fill("abc");
  check("something that isn't a price is refused, the old one kept", await visible(saving.getByText(/That isn't a price/)) && rows()[0].price_cents === 1250);
  await bookBox.getByLabel("Price €").fill("12,50");
  await visible(saving.getByText("✓ Saved"));
  await bookBox.getByRole("group", { name: "Condition" }).getByRole("button", { name: "K4" }).click();
  check("condition is one click", await until(() => rows()[0].condition === "K4"));
  await bookBox.getByLabel("Title", { exact: true }).fill("Tuntematon sotilas (1. painos)");
  check("a typed title becomes 'Yours'", await visible(saving.getByText("✓ Saved")) && await until(() => rows()[0].title_source === "you") && (await bookBox.getByText("Yours").count()) === 1);
  await bookBox.getByLabel("Copies").fill("2");
  await bookBox.getByLabel("Location").fill("Hylly A3");
  await bookBox.getByLabel("Location").blur();
  check("copies and location saved", await until(() => { const r = rows()[0]; return r.quantity === 2 && r.location === "Hylly A3"; }));
  await sleep(4000); // a refresh or two
  check("the refresh doesn't undo what was typed", (await bookBox.getByLabel("Title", { exact: true }).inputValue()) === "Tuntematon sotilas (1. painos)" && (await bookBox.getByLabel("Price €").inputValue()) === "12,50");
  check("queue: Ready to send, with the price", await visible(queue.getByRole("button", { name: /Ready to send.*12,50 €/s })));

  // Sent to the web store (a stand-in), and taken back.
  await pc.getByRole("button", { name: "Send to web store" }).click();
  const inStore = pc.getByRole("status", { name: "In the web store" });
  check("Send: in the web store, with a reference", await visible(inStore.getByText(/reference TEST-[0-9A-F]{8}/)));
  check("…honest that it's a test connection", await visible(inStore.getByText("Test connection: nothing is really sent yet.")));
  book = rows()[0];
  check("…stored as listed", book.status === "listed" && /^TEST-/.test(book.listing_ref) && book.listed_at);
  check("…moved to Listed, fields locked", await visible(pc.getByRole("region", { name: "Listed" }).getByRole("button", { name: /Tuntematon sotilas/ })) && await bookBox.getByLabel("Price €").isDisabled() && (await pc.getByRole("button", { name: "Send to web store" }).count()) === 0);
  const editListed = await pc.request.patch(`/api/extract/bookops/books/${book.id}`, { data: { price: "1" } });
  check("a listed book can't be changed or deleted behind the screen's back", editListed.status() === 409 && (await pc.request.delete(`/api/extract/bookops/books/${book.id}`)).status() === 409 && rows()[0].price_cents === 1250);
  await inStore.getByRole("button", { name: "Take back to change it" }).click();
  check("Take back: a draft again", await visible(pc.getByRole("button", { name: "Send to web store" })) && await until(() => rows()[0].status === "draft" && rows()[0].listing_ref === null));

  // The AI fails: said so; what's typed meanwhile is kept when it's tried again.
  await ai("mode=limit");
  await pc.getByRole("heading", { name: "BookOps" }).click();
  await pc.keyboard.press("Space");
  await until(async () => /Step 2/.test(await step()));
  await pc.keyboard.press("Space");
  const aiNote = pc.getByRole("status", { name: "AI reading" });
  check("AI's limit used up: said so on the new book", await visible(aiNote.getByText(/couldn't read the photos \(The AI's spending limit is used up for now\)/), 30000));
  check("…the new book opened by itself", (await bookBox.getByLabel("Title", { exact: true }).inputValue()) === "" && rows().length === 2);
  await bookBox.getByLabel("Description").fill("Oma teksti.");
  await visible(saving.getByText("✓ Saved"));
  await ai("mode=ok");
  await aiNote.getByRole("button", { name: "try again" }).click();
  book = await until(() => { const r = rows()[1]; return r.ai_status === "done" ? r : null; });
  check("try again: the AI reads it", Boolean(book));
  check("…fills in what's empty (the title)", book && book.title === "Tuntematon sotilas" && book.title_source === "ai" && await until(async () => (await bookBox.getByLabel("Title", { exact: true }).inputValue()) === "Tuntematon sotilas"));
  check("…and leaves what was typed (the text)", book && book.description === "Oma teksti." && book.description_source === "you" && (await bookBox.getByLabel("Description").inputValue()) === "Oma teksti.");

  // Delete.
  pc.once("dialog", (d) => d.accept());
  await pc.getByRole("button", { name: "Delete" }).click();
  check("Delete removes the book", await until(() => rows().length === 1) && await gone(queue.getByRole("button", { name: /Oma teksti|To price.*Tuntematon sotilas$/s }), 5000).then(() => true));

  // A book by its ISBN alone: the databases fill it in.
  await isbnBox.fill("123");
  await pc.getByRole("button", { name: "Add", exact: true }).click();
  check("a wrong ISBN is said so", await visible(pc.getByRole("form", { name: "Add by ISBN" }).getByRole("alert")) && rows().length === 1);
  await isbnBox.fill("951-0-23076-6");
  await pc.getByRole("button", { name: "Add", exact: true }).click();
  check("typed ISBN: title from Finna", await until(async () => (await bookBox.getByLabel("Title", { exact: true }).inputValue().catch(() => "")) === "Pääkallokehrääjä"));
  check("…marked Finna, with author, publisher and year", (await bookBox.getByText("Finna", { exact: true }).count()) === 4 && (await bookBox.getByLabel("Publisher").inputValue()) === "WSOY" && (await bookBox.getByLabel("Year").inputValue()) === "1997" && /Remes/.test(await bookBox.getByLabel("Author").inputValue()));
  book = rows().find((r) => r.isbn13 === "9789510230763");
  check("…stored: typed ISBN, found, no photos, nothing for the AI", book && book.isbn_source === "typed" && book.lookup_status === "found" && book.title_source === "finna" && book.front_photo === null && book.ai_status === "none", JSON.stringify(book));

  // The open book has no photos: the camera's pictures go to it.
  const cameraTitle = () => camera.getByRole("heading").innerText().then((x) => x.replace(/\s+/g, " ").trim());
  check("camera: photos for the open book (no photos yet)", (await cameraTitle()) === "PHOTOS FOR: Pääkallokehrääjä" || /Photos for: Pääkallokehrääjä/i.test(await cameraTitle()), await cameraTitle());
  check("…both sides needed", (await camera.getByRole("list", { name: "Pictures of this book" }).getByRole("listitem").count()) === 2);
  await camera.getByRole("button", { name: "New book instead" }).click();
  check("'New book instead': the camera makes a new book", /new book/i.test(await cameraTitle()) && await visible(camera.getByRole("button", { name: /^Photos for: Pääkallokehrääjä/ })));
  await camera.getByRole("button", { name: /^Photos for: Pääkallokehrääjä/ }).click();
  check("…and back to the open book", /Photos for: Pääkallokehrääjä/i.test(await cameraTitle()));
  const beforeAttach = rows().length;
  await camera.getByLabel("Photo files").setInputFiles([await cover(pc, ["Pääkallokehrääjä"], "#7a2e22"), await cover(pc, ["Jännitysromaani."], "#efe6d2")]);
  check("photos added to the open book, not a new one", await visible(lastBook.getByText(/Photos added to Pääkallokehrääjä/), 30000) && rows().length === beforeAttach);
  book = await until(() => { const r = rows().find((x) => x.isbn13 === "9789510230763"); return r && r.ai_status === "done" ? r : null; });
  check("…stored on it, and the AI read it: text filled in, the database's title kept", book && book.front_photo && book.back_photo && book.description === AI_TEXT && book.description_source === "ai" && book.title === "Pääkallokehrääjä" && book.title_source === "finna", JSON.stringify(book));
  check("…the camera is back to new books", await until(async () => /new book/i.test(await cameraTitle())));
  check("…and the book shows both photos", await until(() => photos.locator("img").count().then((n) => n === 2)));

  // Photo files instead of the camera; no barcode, and the AI misreads the ISBN.
  await ai("book=badisbn");
  await camera.getByLabel("Photo files").setInputFiles([await cover(pc, ["Kotimaan linnut"], "#3d5a40"), await cover(pc, ["Lintukirja kaikille."], "#efe6d2")]);
  check("photo files: added, no barcode found", await visible(lastBook.getByText(/No barcode found in the back photo, so the AI is looking for the ISBN/), 30000));
  book = await until(() => { const r = rows().at(-1); return r.ai_status === "done" ? r : null; });
  check("a misread ISBN (wrong check digit) is dropped, not used", book && book.isbn13 === null && book.lookup_status === "none" && book.title === "Kotimaan linnut" && book.title_source === "ai", JSON.stringify(book));
  check("no ISBN: the price check searches by title", await until(async () => (await pc.getByRole("navigation", { name: "Price check" }).getByRole("link").first().getAttribute("href")) === "https://www.antikvaari.fi/hakukone?q=Kotimaan%20linnut"));
  await bookBox.getByLabel(/No ISBN\. If the book has one, type it/).fill("9789510230763");
  await bookBox.getByLabel("Title", { exact: true }).focus();
  check("an ISBN typed on the book is looked up: the database's title replaces the AI's", await until(async () => (await bookBox.getByLabel("Title", { exact: true }).inputValue()) === "Pääkallokehrääjä"));
  book = rows().at(-1);
  check("…stored", book.isbn13 === "9789510230763" && book.isbn_source === "you" && book.title_source === "finna" && book.lookup_status === "found");
  check("two books with the same ISBN: both tagged in the queue", await until(() => queue.getByText("Same ISBN · 2 in queue").count().then((n) => n === 2)));
  const same = bookBox.getByRole("status", { name: "Same ISBN" });
  check("…and the open one says so, with a way to the other", await visible(same.getByText(/Another copy of this book is in the queue/)));
  const thisId = book.id;
  await same.getByRole("button", { name: "Open the other" }).click();
  check("…which opens it", await until(async () => (await bookBox.getByLabel("Publisher").inputValue()) === "WSOY") && (await queue.locator("[aria-current=true]").count()) === 1 && rows().find((r) => r.id === thisId));

  // The phone is the hand-held scanner: each barcode is a new book on the computer.
  await page.goto("/extract/bookops");
  check("phone: asks for the access code", await visible(page.getByRole("form", { name: "AI reading login" }).getByText("BookOps needs the access code")));
  const before = rows().length;
  const openTitle = await bookBox.getByLabel("Title", { exact: true }).inputValue();
  await logIn(page);
  check("phone: a live barcode scanner, no desktop camera column", await visible(page.getByRole("region", { name: "Camera scanner" })) && (await page.getByRole("region", { name: "Camera", exact: true }).count()) === 0);
  const phoneList = page.getByRole("region", { name: "Sent to the computer" });
  check("phone: the barcode in view is sent by itself", await visible(phoneList.getByText(/ISBN 978-951036686-8/), 30000));
  check("…already in the queue: says another copy was added", await visible(phoneList.getByText(/Already in the queue — added another copy/), 15000));
  check("…no database knows it: says so", await visible(phoneList.getByText("No title found — add it on the computer"), 20000));
  await sleep(3000);
  const scanned = rows().filter((r) => r.isbn13 === "9789510366868");
  check("one book per scan, not one per camera frame", rows().length === before + 1 && scanned.length === 2, JSON.stringify(scanned.map((r) => r.id)));
  const fresh = scanned.find((r) => !r.front_photo);
  check("…stored: ISBN from the barcode, no photos, nothing for the AI", fresh && fresh.isbn_source === "barcode" && fresh.back_photo === null && fresh.ai_status === "none" && fresh.lookup_status === "not_found", JSON.stringify(fresh));
  check("computer: the scanned book appears without reloading", await visible(pc.getByRole("region", { name: "To do" }).getByRole("heading", { name: `To do (${before + 1})` }), 15000));
  check("…without taking the open book away", (await bookBox.getByLabel("Title", { exact: true }).inputValue()) === openTitle);
  check("…tagged as the same ISBN as the other copy", await until(() => queue.getByText("Same ISBN · 2 in queue").count().then((n) => n >= 2)));

  // No barcode: the back cover photographed on the phone is the book, and its back cover.
  await ai("book=isbn");
  await page.getByLabel("Back cover photo").setInputFiles(await cover(page, ["Jännitysromaani."], "#efe6d2"));
  check("phone: back cover sent; the AI's ISBN gives the title", await visible(phoneList.getByText("Pääkallokehrääjä"), 30000) && await visible(phoneList.getByText(/ISBN 978-951023076-3/)));
  book = await until(() => { const r = rows().at(-1); return rows().length === before + 2 && r.ai_status === "done" && r.lookup_status === "found" ? r : null; });
  check("…stored: the photo as the back cover, ISBN read by the AI (10 digits, made 13), title from the database", book && book.back_photo && !book.front_photo && book.isbn13 === "9789510230763" && book.isbn_source === "ai" && book.title_source === "finna" && book.description_source === "ai", JSON.stringify(book));
  await visible(pc.getByRole("region", { name: "To do" }).getByRole("heading", { name: `To do (${before + 2})` }), 15000);
  await pc.getByRole("region", { name: "To do" }).getByRole("button").first().click();
  check("computer: opened, its ISBN marked as read by the AI", await visible(bookBox.getByText(/ISBN 978-951023076-3/)) && await visible(bookBox.getByText("AI read it · check")));
  check("…the camera asks only for the front cover", /Photos for: Pääkallokehrääjä/i.test(await cameraTitle()) && (await camera.getByRole("list", { name: "Pictures of this book" }).getByRole("listitem").allInnerTexts()).join("|").replace(/\s+/g, " ").trim() === "Still needed Front cover");
  const backKey = book.back_photo;
  await pc.getByRole("heading", { name: "BookOps" }).click();
  await pc.keyboard.press("Space");
  check("one picture: the front added to that book", await until(() => { const r = rows().find((x) => x.id === book.id); return r.front_photo && r.back_photo === backKey; }) && rows().length === before + 2);
  check("…the camera is back to new books", await until(async () => /new book/i.test(await cameraTitle())));

  // Stops by itself after 10 minutes without a picture.
  const idle = await pcCtx.newPage();
  await idle.clock.install();
  await idle.goto("/extract/bookops");
  const idleCamera = idle.getByRole("region", { name: "Camera" });
  await visible(idleCamera.getByText("LIVE"));
  await idle.clock.fastForward("09:00");
  check("still live after 9 minutes", await visible(idleCamera.getByText("LIVE"), 3000));
  await idle.clock.fastForward("01:30");
  check("off by itself after 10 minutes without a picture, and says so", await visible(idleCamera.getByRole("status", { name: "Camera off" }).getByText(/stopped by itself after 10 minutes without a picture/)));
  await idle.close();

  // The rest of the app is as it was.
  check("no other table touched", sql("SELECT (SELECT COUNT(*) FROM editions) + (SELECT COUNT(*) FROM copies) + (SELECT COUNT(*) FROM saved_texts) AS n")[0].n === 0);

  await b.close();
  t.done();
})().catch(t.crash);
