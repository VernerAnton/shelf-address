// seed: none
// BookOps (spec-corrections §30): the Extract tab's two options; on a computer,
// one screen — queue, book, camera. Back and front cover photographed (Space),
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
  const b = await browser("upright"); // the camera shows a book's barcode: 9789510366868, which no stand-in database knows
  const page = await phone(b, t);
  const pcCtx = await b.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 950 }, permissions: ["camera"] });
  await pcCtx.route(/^https:\/\/www\.(antikvaari\.fi|adlibris\.com|suomalainen\.com|akateeminen\.com)\//, (r) => r.fulfill({ contentType: "text/html", body: "<title>shop stand-in</title>" }));
  const pc = await pcCtx.newPage();
  pc.setDefaultTimeout(20000);
  pc.on("pageerror", (e) => t.errors.push(String(e)));
  // Retried: a page still settling after a navigation can drop the first read.
  const settled = async (read) => {
    for (let i = 0; ; i++) {
      try {
        return await read();
      } catch (e) {
        if (i >= 5) throw e;
        await sleep(500);
      }
    }
  };
  const labels = (nav) => settled(() => nav.getByRole("link").allInnerTexts()).then((x) => x.map((s) => s.trim()).join(","));
  const current = (nav) => settled(() => nav.locator("[aria-current=page]").allInnerTexts()).then((x) => x.map((s) => s.trim()).join(","));

  // The Extract tab: two options, and it still opens Text Extract.
  const main = page.getByRole("navigation", { name: "Main" });
  const sub = page.getByRole("navigation", { name: "Extract" });
  await page.goto("/evaluate");
  check("phone: no Extract row outside Extract", (await sub.count()) === 0);
  // Tapped again if the first tap is lost (the first page on a freshly started server can still be starting up).
  for (let i = 0; i < 3 && !/\/extract$/.test(page.url()); i++) {
    await main.getByRole("link", { name: "Extract" }).click();
    await page.waitForURL(/\/extract$/, { timeout: 15000 }).catch(() => {});
  }
  check("phone: the Extract tab still opens Text Extract (the camera)", await visible(page.getByRole("heading", { name: "Extract" })));
  check("phone: Extract row — BookOps left, Text Extract right", (await labels(sub)) === "BookOps,Text Extract", await labels(sub).catch(() => ""));
  check("phone: Text Extract marked", (await current(sub)) === "Text Extract" && (await current(main)) === "Extract");
  check("the Extract row sits just above the main row", await page.evaluate(() => {
    const s = document.querySelector("nav[aria-label=Extract]").getBoundingClientRect();
    const m = document.querySelector("nav[aria-label=Main]").getBoundingClientRect();
    return s.bottom <= m.top + 1 && m.top - s.bottom < 4 && s.height >= 44;
  }));
  // Tapped again if the first tap is lost (it can land while the page is still starting up).
  for (let i = 0; i < 3 && !/\/extract\/bookops$/.test(page.url()); i++) {
    await sub.getByRole("link", { name: "BookOps" }).click();
    await page.waitForURL(/\/extract\/bookops$/, { timeout: 10000 }).catch(() => {});
  }
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
  // The first visit compiles a big page; on a just-built test server that has taken over 20 s.
  await pc.waitForURL(/\/extract\/bookops$/, { timeout: 60000 });
  check("computer: BookOps opens from the row", await visible(pc.getByRole("heading", { name: "BookOps" })) && (await current(pcSub)) === "BookOps");

  // Behind the access code, like Saved texts.
  check("computer: asks for the access code", await visible(pc.getByRole("form", { name: "AI reading login" }).getByText("BookOps needs the access code")));
  const refused = await pc.request.get("/api/extract/bookops/books");
  check("the books can't be read without the code", refused.status() === 401 && (await refused.json()).kind === "login");
  check("…nor a photo", (await pc.request.get("/api/extract/bookops/photos/x-front-1.jpg")).status() === 401);
  check("…nor a book added", (await pc.request.post("/api/extract/bookops/books", { multipart: { id: "12345678", isbn: "9789510230763", isbnSource: "typed" } })).status() === 401 && rows().length === 0);
  await logIn(pc);
  // The computer's own camera is off unless chosen: the phone takes the photos.
  const fromPhone = pc.getByRole("region", { name: "Photos from the phone" });
  check("computer: the camera is off by default, photos come from the phone", await visible(fromPhone.getByText(/Taken on the phone/)) && (await pc.getByRole("region", { name: "Camera", exact: true }).count()) === 0 && (await pc.locator("video").count()) === 0);
  await fromPhone.getByRole("button", { name: "Use the computer's camera" }).click();
  const camera = pc.getByRole("region", { name: "Camera", exact: true });
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
  check("…Space takes nothing", /Step 1 Back cover/.test(await camera.locator("[aria-current=step]").innerText().then((s) => s.replace(/\s+/g, " "))));
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

  // The view: upright (book-shaped) by default; zoom, turn and whole picture, remembered on this computer.
  const viewSize = () => camera.getByRole("img", { name: "Camera view" }).or(camera.locator("canvas[aria-label='Camera view']")).first().evaluate((c) => [c.width, c.height]);
  const settings = camera.getByRole("group", { name: "Camera view settings" });
  check("the view is upright, 3:4", await until(async () => { const [w, h] = await viewSize(); return w > 0 && Math.abs(w / h - 0.75) < 0.01; }), JSON.stringify(await viewSize()));
  const [w1] = await viewSize();
  await settings.getByRole("button", { name: "Zoom in" }).click();
  check("zoom in: 1,25×, a smaller part of the picture", (await settings.getByLabel("Zoom", { exact: true }).innerText()) === "1,25×" && await until(async () => (await viewSize())[0] < w1));
  await settings.getByRole("button", { name: "Whole picture" }).click();
  check("whole picture: not cut to a book shape", await until(async () => { const [w, h] = await viewSize(); return Math.abs(w / h - 4 / 3) < 0.01; }));
  await settings.getByRole("button", { name: /^Turn/ }).click();
  check("turn: 90°, the picture turned on its side", /90°/.test(await settings.getByRole("button", { name: /^Turn/ }).innerText()) && await until(async () => { const [w, h] = await viewSize(); return Math.abs(w / h - 3 / 4) < 0.01; }));
  await pc.reload();
  check("the view is remembered on this computer", await visible(camera.getByText("LIVE")) && (await settings.getByLabel("Zoom", { exact: true }).innerText()) === "1,25×" && /90°/.test(await settings.getByRole("button", { name: /^Turn/ }).innerText()) && await visible(settings.getByRole("button", { name: "Book-shaped" })));
  await settings.getByRole("button", { name: "Book-shaped" }).click();
  await settings.getByRole("button", { name: "Zoom out" }).click();
  for (let i = 0; i < 3; i++) await settings.getByRole("button", { name: /^Turn/ }).click();
  check("…and back to upright, 1×, not turned", (await settings.getByLabel("Zoom", { exact: true }).innerText()) === "1×" && (await settings.getByRole("button", { name: /^Turn/ }).innerText()).trim() === "Turn ↻" && await until(async () => (await viewSize())[0] === w1));

  // Space takes the picture — but not while typing.
  const isbnBox = pc.getByRole("form", { name: "Add by ISBN" }).getByLabel("ISBN");
  await isbnBox.click();
  await pc.keyboard.press("Space");
  await sleep(700);
  check("Space while typing takes no picture", /Step 1 Back cover/.test(await step()) && (await isbnBox.inputValue()) === " ", await step());
  await isbnBox.fill("");
  await pc.getByRole("heading", { name: "BookOps" }).click();
  await pc.keyboard.press("Space");
  check("Space: back cover first (the barcode side), now the front", await until(async () => /Step 2 Front cover/.test(await step())), await step());
  check("…the photos can be retaken", await visible(camera.getByRole("button", { name: "Retake" })));
  check("nothing stored yet", rows().length === 0);
  await pc.keyboard.press("Space");
  check("Space again: the book is added, ISBN from the barcode", await visible(lastBook.getByText(/Added to the queue\. ISBN 978-951036686-8 read from the barcode/), 30000));
  check("the camera is ready for the next book at once", /Step 1 Back cover/.test(await step()));
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
  check("…saved book-shaped (upright 3:4), as the camera view showed them", await photos.locator("img").evaluateAll((imgs) => imgs.every((i) => Math.abs(i.naturalWidth / i.naturalHeight - 0.75) < 0.01)), await photos.locator("img").evaluateAll((imgs) => imgs.map((i) => `${i.naturalWidth}x${i.naturalHeight}`).join(",")));
  // A photo shown large, and closed again: ✕, Esc, or a click beside it.
  const viewer = pc.getByRole("dialog");
  await photos.getByRole("button", { name: /Show larger: Front cover/ }).click();
  check("photo: shown large over the page", await visible(viewer.getByRole("img")) && pc.url().endsWith("/extract/bookops"));
  await pc.keyboard.press("Escape");
  check("…Esc closes it", await gone(viewer, 5000));
  await photos.getByRole("button", { name: /Show larger: Back cover/ }).click();
  await visible(viewer.getByRole("img"));
  await pc.mouse.click(5, 5);
  check("…a click beside the photo closes it", await gone(viewer, 5000));
  await photos.getByRole("button", { name: /Show larger: Front cover/ }).click();
  await viewer.getByRole("button", { name: "Close" }).click();
  check("…and so does Close", await gone(viewer, 5000));
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

  // Photos on the phone: the scanned listing is under "Needs photos"; BookOps' own camera, back then front.
  const needsPhotos = page.getByRole("region", { name: "Needs photos" });
  check("phone: right after a scan, 'Add photos now'", await visible(phoneList.getByRole("button", { name: "Add photos now" }), 15000));
  const needRow = needsPhotos.getByRole("button", { name: /ISBN 978-951036686-8.*Back and front cover/s });
  check("phone: the scanned listing is under Needs photos, back and front", await visible(needRow, 15000));
  await needRow.click();
  const taking = page.getByRole("region", { name: "Taking photos" });
  const stepText = () => taking.getByRole("status", { name: "Step" }).evaluate((el) => [...el.children].map((c) => c.textContent.trim()).join(" "));
  const shutter = taking.getByRole("button", { name: "Take picture" });
  check("tap: BookOps' camera, full screen, for that listing", await visible(taking.getByText(/Photos for: ISBN 978-951036686-8/)) && await taking.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top === 0 && r.height === innerHeight; }));
  check("…step 1 of 2 on screen: back cover, the barcode side", (await stepText()) === "1 of 2 Back cover The side with the barcode · fill the frame with the book", await stepText());
  check("…the scanner paused", await visible(page.getByRole("button", { name: "Scan with camera" })));
  check("…the camera live, the shutter ready", await until(() => shutter.isEnabled()));
  // The dotted frame's shape: the saved photos must have it (what's inside the frame is what's saved).
  const frameAspect = await taking.evaluate((el) => { const r = el.querySelector(".border-dashed").getBoundingClientRect(); return r.width / r.height; });
  await shutter.click();
  check("shutter: back taken, on to the front by itself", await until(async () => (await stepText()) === "2 of 2 Turn the book over: front cover This is the listing's picture · fill the frame with the book") && await visible(taking.getByRole("img", { name: "Back cover taken" })) && !rows().find((r) => r.id === fresh.id).back_photo, await stepText());
  await taking.getByRole("button", { name: "Retake" }).click();
  check("Retake: back to the back cover", (await stepText()) === "1 of 2 Back cover The side with the barcode · fill the frame with the book" && (await taking.getByRole("img", { name: "Back cover taken" }).count()) === 0);
  await shutter.click();
  await until(async () => /^2 of 2/.test(await stepText()));
  await ai("book=plain");
  await shutter.click();
  check("front taken: the camera closes, both sent to the listing, the scanner back on", await until(() => { const r = rows().find((x) => x.id === fresh.id); return r.front_photo && r.back_photo; }) && await gone(taking, 10000) && await visible(page.getByRole("region", { name: "Camera scanner" }).getByText(/Point at the barcode/), 15000));
  book = await until(() => { const r = rows().find((x) => x.id === fresh.id); return r.ai_status === "done" ? r : null; });
  check("…the AI read them: text filled in, its title too (no database knew it)", book && book.description === AI_TEXT && book.title === "Tuntematon sotilas" && book.title_source === "ai" && rows().length === before + 1, JSON.stringify(book));
  await sleep(4000);
  check("…the scanner, back on and still seeing that book, doesn't add it again", rows().length === before + 1, String(rows().length - before));
  check("…and it's off the Needs photos list", await until(async () => (await needsPhotos.getByRole("button", { name: /ISBN 978-951036686-8/ }).count()) === 0));
  await pc.getByRole("region", { name: "To do" }).getByRole("button", { name: /Tuntematon sotilas/ }).first().click();
  check("computer: the phone's photos and text show on the listing", await until(async () => (await bookBox.getByLabel("Description").inputValue()) === AI_TEXT) && await until(() => photos.locator("img").count().then((n) => n === 2)));
  const shapes = await until(() => photos.locator("img").evaluateAll((imgs) => (imgs.every((i) => i.complete && i.naturalWidth) ? imgs.map((i) => i.naturalWidth / i.naturalHeight) : null)));
  check("…cut to the dotted frame: the photos have its shape", shapes && shapes.every((a) => Math.abs(a - frameAspect) < 0.03), JSON.stringify({ shapes, frameAspect }));

  // No barcode: the back cover photographed on the phone is the book, and its back cover.
  await ai("book=isbn");
  await page.getByRole("button", { name: "No barcode? Photograph the back cover" }).click();
  check("no barcode: the camera for one photo, the back cover", await visible(taking.getByText("New listing — a book without a barcode")) && /^Photo Back cover/.test(await stepText()));
  // The phone's camera app instead: one tap away, its photo counts as the step.
  const chooser = page.waitForEvent("filechooser");
  await taking.getByRole("button", { name: /Use the phone's camera app instead/ }).click();
  await (await chooser).setFiles(await cover(page, ["Jännitysromaani."], "#efe6d2"));
  check("…the camera app's photo is used, and the camera closes", await gone(taking, 15000));
  check("phone: back cover sent; the AI's ISBN gives the title", await visible(phoneList.getByText("Pääkallokehrääjä"), 30000) && await visible(phoneList.getByText(/ISBN 978-951023076-3/)));
  // Found by what it is, not by being the newest: the test camera always shows a barcode, which the
  // scanner can read once more when BookOps' camera closes (a real desk has no such ever-present barcode).
  book = await until(() => rows().find((r) => r.isbn_source === "ai" && !r.front_photo && r.ai_status === "done" && r.lookup_status === "found") ?? null);
  check("phone: that listing is under Needs photos, front still needed", await visible(page.getByRole("region", { name: "Needs photos" }).getByRole("button", { name: /Pääkallokehrääjä.*Front cover still needed/s }), 15000));
  check("…stored: the photo as the back cover, ISBN read by the AI (10 digits, made 13), title from the database", book && book.back_photo && !book.front_photo && book.isbn13 === "9789510230763" && book.isbn_source === "ai" && book.title_source === "finna" && book.description_source === "ai", JSON.stringify(book));
  await visible(pc.getByRole("region", { name: "To do" }).getByRole("button", { name: /Pääkallokehrääjä/ }).first(), 15000);
  // The newest "Pääkallokehrääjä" in the list (newest first) is this one.
  await until(async () => (await pc.getByRole("region", { name: "To do" }).getByRole("button").count()) >= rows().filter((r) => r.status === "draft").length);
  await pc.getByRole("region", { name: "To do" }).getByRole("button", { name: /Pääkallokehrääjä/ }).first().click();
  check("computer: opened, its ISBN marked as read by the AI", await visible(bookBox.getByText(/ISBN 978-951023076-3/)) && await visible(bookBox.getByText("AI read it · check")));
  check("…the camera asks only for the front cover", /Photos for: Pääkallokehrääjä/i.test(await cameraTitle()) && (await camera.getByRole("list", { name: "Pictures of this book" }).getByRole("listitem").allInnerTexts()).join("|").replace(/\s+/g, " ").trim() === "Still needed Front cover");
  const backKey = book.back_photo;
  await pc.getByRole("heading", { name: "BookOps" }).click();
  await pc.keyboard.press("Space");
  check("one picture: the front added to that book, not a new one", await until(() => { const r = rows().find((x) => x.id === book.id); return r.front_photo && r.back_photo === backKey; }) && rows().filter((r) => r.isbn13 === "9789510230763" && r.isbn_source === "ai").length === 1);
  check("…the camera is back to new books", await until(async () => /new book/i.test(await cameraTitle())));

  // Stops by itself after 10 minutes without a picture.
  const idle = await pcCtx.newPage();
  await idle.clock.install();
  await idle.goto("/extract/bookops");
  const idleCamera = idle.getByRole("region", { name: "Camera", exact: true });
  await visible(idleCamera.getByText("LIVE"));
  await idle.clock.fastForward("09:00");
  check("still live after 9 minutes", await visible(idleCamera.getByText("LIVE"), 3000));
  await idle.clock.fastForward("01:30");
  check("off by itself after 10 minutes without a picture, and says so", await visible(idleCamera.getByRole("status", { name: "Camera off" }).getByText(/stopped by itself after 10 minutes without a picture/)));
  await idle.close();

  // Focus: this fake camera can't be focused by the browser — said so.
  check("a camera without browser focus control: says it keeps its own autofocus", await visible(camera.getByRole("group", { name: "Focus" }).getByText(/doesn't let the browser set its focus/)));
  // A webcam that can (simulated: what Chrome reports for one), with its autofocus landed at 0.3.
  const fpage = await pcCtx.newPage();
  await fpage.addInitScript(() => {
    window.__focus = [];
    const P = MediaStreamTrack.prototype;
    const caps = P.getCapabilities, settings = P.getSettings, apply = P.applyConstraints;
    let now = { focusMode: "continuous", focusDistance: 0.3 };
    P.getCapabilities = function () { return { ...caps.call(this), focusMode: ["manual", "single-shot", "continuous"], focusDistance: { min: 0.1, max: 2, step: 0.05 } }; };
    P.getSettings = function () { return { ...settings.call(this), ...now }; };
    P.applyConstraints = async function (c) {
      const a = (c && c.advanced && c.advanced[0]) || {};
      if ("focusMode" in a) { window.__focus.push(a); now = { ...now, ...a }; return; }
      return apply.call(this, c);
    };
  });
  await fpage.goto("/extract/bookops");
  const fcam = fpage.getByRole("region", { name: "Camera", exact: true });
  const focusGroup = fcam.getByRole("group", { name: "Focus" });
  const applied = () => fpage.evaluate(() => window.__focus);
  check("focus: Auto and Fixed offered, Auto to start", await visible(focusGroup.getByRole("button", { name: "Fixed" })) && (await focusGroup.getByRole("button", { name: "Auto" }).getAttribute("aria-pressed")) === "true");
  await focusGroup.getByRole("button", { name: "Fixed" }).click();
  check("Fixed: the focus stays where autofocus landed", await until(async () => JSON.stringify((await applied()).at(-1)) === JSON.stringify({ focusMode: "manual", focusDistance: 0.3 })), JSON.stringify(await applied()));
  await focusGroup.getByLabel("Focus distance").fill("0.5");
  check("…adjustable: nearer or farther", await until(async () => (await applied()).at(-1).focusDistance === 0.5));
  await fpage.reload();
  check("…remembered for this camera: fixed again when the camera starts", await visible(fcam.getByText("LIVE")) && await until(async () => JSON.stringify((await applied())[0]) === JSON.stringify({ focusMode: "manual", focusDistance: 0.5 })) && (await focusGroup.getByLabel("Focus distance").inputValue()) === "0.5");
  await focusGroup.getByRole("button", { name: "Auto" }).click();
  check("Auto: the camera's own autofocus again", await until(async () => (await applied()).at(-1).focusMode === "continuous") && (await focusGroup.getByLabel("Focus distance").count()) === 0);
  await fpage.close();

  // The rest of the app is as it was.
  check("no other table touched", sql("SELECT (SELECT COUNT(*) FROM editions) + (SELECT COUNT(*) FROM copies) + (SELECT COUNT(*) FROM saved_texts) AS n")[0].n === 0);

  await b.close();
  t.done();
})().catch(t.crash);
