// seed: places
// Saved texts (spec-corrections §24): Extract's texts from a logged-in phone
// appear on the computer by themselves; corrections follow; Copy, Done,
// Delete; behind the access code; laid out for a big screen. Since V28 (§28):
// the front cover photo, the AI's back photos kept, reporting from the computer.
const { suite, browser, phone, visible, sleep, sql, chromium, BASE_URL, BOOKS } = require("./lib.cjs");

const cover = (page, lines) => page.evaluate((lines) => {
  const c = document.createElement("canvas"); c.width = 2400; c.height = 3200;
  const x = c.getContext("2d"); x.fillStyle = "#f3eee2"; x.fillRect(0, 0, 2400, 3200);
  x.fillStyle = "#1d1d1d"; x.font = "64px Georgia, serif";
  lines.forEach((l, i) => x.fillText(l, 300, 500 + i * 100));
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, lines).then((b64) => Buffer.from(b64, "base64"));
// A front cover photo straight from a phone camera (3000×4000).
const frontCover = (page, colour) => page.evaluate((colour) => {
  const c = document.createElement("canvas"); c.width = 3000; c.height = 4000;
  const x = c.getContext("2d"); x.fillStyle = colour; x.fillRect(0, 0, 3000, 4000);
  for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`; x.fillRect((i * 131) % 2900, (i * 197) % 3900, 100, 100); }
  x.fillStyle = "#fff"; x.font = "bold 220px Georgia, serif"; x.fillText("TUNTEMATON", 300, 1200);
  return c.toDataURL("image/jpeg", 0.9).split(",")[1];
}, colour).then((b64) => Buffer.from(b64, "base64"));
// A JPEG's size, from its SOF marker.
const jpegSize = (buf) => {
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
};
const AI_TEXT = "Väinö Linnan romaani kertoo suomalaisesta konekiväärikomppaniasta jatkosodassa.\n\nTeos on myyty yli miljoona kappaletta.";
const logIn = async (page) => {
  const form = page.getByRole("form", { name: "AI reading login" });
  await form.getByLabel(/access code/).fill("test-code");
  await form.getByRole("button", { name: "Log in" }).click();
};

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  const page = await phone(b, t, { permissions: ["camera", "clipboard-read", "clipboard-write"] });
  // The computer: a desktop-sized window, its own browser session.
  const pcCtx = await b.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 860 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  // The "Save as" window (V34.2), recorded instead of opened: what it was asked, and what was written.
  await pcCtx.addInitScript(() => {
    window.__saveAs = [];
    window.showSaveFilePicker = async (options) => ({
      createWritable: async () => ({ write: async (blob) => window.__saveAs.push({ options, bytes: blob.size, type: blob.type }), close: async () => {} }),
    });
  });
  const pc = await pcCtx.newPage();
  pc.setDefaultTimeout(20000);
  pc.on("pageerror", (e) => t.errors.push(String(e)));
  const rows = () => sql("SELECT id, text, source, done_at FROM saved_texts ORDER BY created_at");
  const box = page.getByLabel(/Text — check and correct it/);
  // Start over goes straight to the camera (V28); the camera is let go unused here.
  const startOver = async () => {
    const camera = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: "Start over" }).click();
    return camera;
  };
  const take = async (lines) => page.getByLabel("Text photo").setInputFiles({ name: "IMG.jpg", mimeType: "image/jpeg", buffer: await cover(page, lines) });

  // Not logged in anywhere: nothing saved, and the list needs the code.
  await page.goto("/extract");
  await take(["Kotimainen romaani kesästä saaristossa."]);
  await visible(box, 120000);
  await sleep(2000);
  check("phone not logged in: nothing saved for the computer", rows().length === 0);
  check("…and no 'saved' line", (await page.getByRole("status", { name: "Saved for the computer" }).count()) === 0);
  const refused = await pc.request.get("/api/extract/texts");
  check("the list can't be read without the code", refused.status() === 401);
  // A computer opens straight on Saved texts — from the app's address, and from the Extract tab.
  await pc.goto("/");
  check("computer: the app opens on Saved texts", await pc.waitForURL(/\/extract\/saved$/).then(() => true, () => false), pc.url());
  await pc.goto("/extract");
  check("computer: the Extract tab goes to Saved texts too", /\/extract\/saved$/.test(pc.url()), pc.url());
  await page.goto("/");
  check("phone: still opens on Evaluate", await page.waitForURL(/\/evaluate$/).then(() => true, () => false), page.url());
  await page.goto("/extract");
  check("phone: Extract tab is still the camera", await visible(page.getByRole("heading", { name: "Extract" })));
  await pc.goto("/extract/saved");
  check("computer: asks for the access code", await visible(pc.getByRole("form", { name: "AI reading login" }).getByText("Saved texts need the access code")));
  await logIn(pc);
  check("computer: logged in, empty list explained", await visible(pc.getByText(/Nothing saved yet/)));

  // Phone logs in; a reading is saved and shows on the computer by itself.
  await startOver();
  await logIn(page);
  await visible(page.getByText(/Read by AI/));
  await take(["anything"]);
  const aiRead = await page.waitForFunction(() => /konekiväärikomppaniasta/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 }).then(() => true, () => false);
  check("phone: AI text read", aiRead);
  check("phone: says it's saved for the computer", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved — it's on the computer/), 15000));
  check("stored once, marked as read by AI", rows().length === 1 && rows()[0].text === AI_TEXT && rows()[0].source === "ai", JSON.stringify(rows()));
  const list = pc.locator("[aria-label='Saved texts']");
  check("computer: appears without reloading", await visible(list.getByRole("button", { name: /Väinö Linnan romaani/ }), 15000));
  const shown = pc.getByRole("region", { name: "Selected text" }).getByLabel("Text");
  check("computer: newest opened straight away, in full", await visible(shown) && (await shown.inputValue()).trim() === AI_TEXT);

  // A correction on the phone follows.
  await box.fill(AI_TEXT.replace("miljoona", "kaksi miljoonaa"));
  check("phone: correction saved", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved — it's on the computer/), 15000));
  check("computer: the correction shows up", await pc.waitForFunction(() => /kaksi miljoonaa/.test(document.querySelector("[aria-label='Selected text'] [aria-label='Text']")?.value ?? ""), null, { timeout: 15000 }).then(() => true, () => false));
  check("still one text, not two", rows().length === 1);

  // Start over: a new text, newest first.
  await startOver();
  check("start over keeps the first one saved", rows().length === 1);
  await sleep(1100); // a different minute isn't needed, just a later time
  await take(["second"]);
  await page.waitForFunction(() => /Väinö/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 });
  await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved —/), 15000);
  check("start over: the next reading is a new text", rows().length === 2);
  check("computer: both listed, newest first", await pc.waitForFunction(() => document.querySelectorAll("[aria-label='Saved texts'] li").length === 2, null, { timeout: 15000 }).then(() => true, () => false));

  // The AI's back photos are kept with their texts (V28), for reporting from the computer.
  const readings = () => sql("SELECT text_id, photo_key, reply FROM saved_text_readings ORDER BY read_at");
  const textIds = rows().map((r) => r.id);
  check("each back photo the AI read is kept with its text, with the answer", readings().length === 2 && readings().every((r) => textIds.includes(r.text_id) && r.photo_key && /konekiväärikomppaniasta/.test(r.reply)), JSON.stringify(readings()));

  // Front cover (V28): after the back text, a photo of the front goes to the computer.
  const coverArea = page.getByRole("region", { name: "Front cover" });
  check("phone: front cover button after the back text", await visible(coverArea.getByRole("button", { name: "Take a photo of the front cover" })));
  await page.getByLabel("Front cover photo").setInputFiles({ name: "COVER.jpg", mimeType: "image/jpeg", buffer: await frontCover(page, "#7a1f1f") });
  check("phone: says the front cover is saved", await visible(coverArea.getByText("✓ Front cover saved for the computer"), 15000));
  const newest = rows().at(-1);
  const withCover = () => sql("SELECT id, cover_key FROM saved_texts WHERE cover_key IS NOT NULL");
  check("stored with the text it was taken for", withCover().length === 1 && withCover()[0].id === newest.id, JSON.stringify(withCover()));
  const firstKey = withCover()[0]?.cover_key;
  const pic = await pc.request.get(`/api/extract/texts/${newest.id}/cover`);
  const size = jpegSize(await pic.body());
  check("…made 1600 px on its long side, as a JPEG", pic.ok() && size && Math.max(size.width, size.height) === 1600, JSON.stringify(size));
  check("…and only for the logged in", (await fetch(`${BASE_URL}/api/extract/texts/${newest.id}/cover`)).status === 401);
  check("phone: no preview or retake button (the camera asks)", (await coverArea.getByRole("img").count()) === 0 && (await page.getByRole("button", { name: /Retake/ }).count()) === 0);
  await page.getByLabel("Front cover photo").setInputFiles({ name: "COVER.jpg", mimeType: "image/jpeg", buffer: await frontCover(page, "#1f3a7a") });
  await sleep(1500);
  check("another photo replaces it", withCover().length === 1 && withCover()[0].cover_key !== firstKey, JSON.stringify(withCover()));

  // On the computer: large, beside the text.
  await list.getByRole("button").first().click();
  const figure = pc.getByRole("figure", { name: "Front cover" });
  check("computer: the front cover shows", await visible(figure.getByRole("img", { name: "Front cover" })));
  await pc.waitForFunction(() => document.querySelector("figure img")?.naturalWidth > 0, null, { timeout: 10000 }).catch(() => {});
  const placed = await pc.evaluate(() => {
    const img = document.querySelector("figure img").getBoundingClientRect();
    const text = document.querySelector("[aria-label='Selected text'] textarea").getBoundingClientRect();
    return { beside: img.left >= text.right, tall: img.height, textTall: text.height, whole: document.querySelector("figure img").naturalWidth > 0 };
  });
  check("…beside the text, big enough to judge (held to what the text's width can spare)", placed.beside && placed.whole && placed.tall >= 260, JSON.stringify(placed));
  check("…and a small one in the list", (await list.getByRole("button").first().locator("img").count()) === 1 && (await list.getByRole("button").last().locator("img").count()) === 0);
  // A big screen (like the shop's, 1536×730 in the browser): the page grows to use the width (V28).
  await pc.setViewportSize({ width: 1536, height: 730 });
  await sleep(300);
  const wide = await pc.evaluate(() => {
    const tops = [...document.querySelectorAll("[aria-label='Selected text'] button")].filter((x) => /^(Copy|Copied ✓|No ISBN|ISBN copied ✓|97[89]-\d{9}-\d|Delete|Report a ?problem)$/.test(x.textContent.trim())).map((x) => Math.round(x.getBoundingClientRect().top));
    return { main: document.querySelector("main").getBoundingClientRect().width, rows: new Set(tops).size, scroll: document.documentElement.scrollHeight - innerHeight, cover: document.querySelector("figure img").getBoundingClientRect().height };
  });
  check("big screen with a cover: the page uses the width, buttons on one row, no scrolling", wide.main > 1400 && wide.rows === 1 && wide.scroll <= 1 && wide.cover >= 360, JSON.stringify(wide)); // 360: Extract has two bottom rows since V33
  // V31: Report a problem on two lines, and Copy keeps its width when it says Copied, so nothing jumps to a second row.
  for (const [w, h] of [[1366, 768], [1280, 860], [1536, 730]]) {
    await pc.setViewportSize({ width: w, height: h });
    await pc.getByRole("region", { name: "Selected text" }).getByRole("button", { name: /^(Copy|Copied ✓)$/ }).click();
    await sleep(300);
    const after = await pc.evaluate(() => {
      const btns = [...document.querySelectorAll("[aria-label='Selected text'] button")].filter((x) => /^(Copy|Copied ✓|No ISBN|ISBN copied ✓|97[89]-\d{9}-\d|Delete|Report a ?problem)$/.test(x.textContent.trim()));
      return { n: btns.length, rows: new Set(btns.map((x) => Math.round(x.getBoundingClientRect().top))).size, copied: btns.some((x) => x.textContent.includes("Copied")) };
    });
    check(`${w}×${h}: after Copy, the buttons stay on one row`, after.n === 4 && after.rows === 1 && after.copied, JSON.stringify(after));
  }
  await pc.setViewportSize({ width: 1280, height: 860 });
  await figure.getByRole("button", { name: "Copy picture" }).click();
  check("Copy picture puts the picture on the clipboard", await visible(figure.getByRole("button", { name: "Picture copied ✓" })) && (await pc.evaluate(async () => (await navigator.clipboard.read())[0].types)).includes("image/png"));
  await figure.getByRole("button", { name: "Download picture" }).click();
  check("Download picture: the Save as window, so a folder can be chosen", await visible(figure.getByRole("button", { name: "Saved ✓" })));
  const saveAs = (await pc.evaluate(() => window.__saveAs))[0];
  check("…a .jpg named after the book, the picture itself written", saveAs && /^etukansi-vaino-linnan-romaani.*\.jpg$/.test(saveAs.options.suggestedName) && saveAs.bytes > 10000 && saveAs.type === "image/jpeg", JSON.stringify(saveAs));
  check("…and the folder remembered for next time (the same id each time)", saveAs && saveAs.options.id === "front-covers", JSON.stringify(saveAs && saveAs.options));
  await figure.getByRole("img", { name: "Front cover" }).click();
  const full = pc.getByRole("dialog", { name: "Front cover, full size" });
  check("click: full size", await visible(full));
  await pc.keyboard.press("Escape");
  check("…Esc closes it", await full.waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false));
  check("no Download .txt any more", (await pc.getByRole("button", { name: "Download .txt" }).count()) === 0);

  // V33.1: how long the AI took, and a small picture editor — rotate, crop, undo.
  const about = pc.getByRole("region", { name: "Selected text" }).getByLabel("About this text");
  check("computer: just the times on the line; on hover, which model read it and how long it took (V34.4)", !/read by/i.test(await about.innerText()) && /^Read by AI \(Gemini 3\.1 Flash-Lite · no thinking\) in \d+\.\d s/.test(await about.getAttribute("title")), JSON.stringify([await about.innerText(), await about.getAttribute("title")]));
  const coverSize = async () => jpegSize(await (await pc.request.get(`/api/extract/texts/${newest.id}/cover`)).body());
  const waitForSize = async (want) => {
    for (let i = 0; i < 20; i++) { const got = await coverSize(); if (want(got)) return got; await sleep(300); }
    return coverSize();
  };
  const tall = await coverSize();
  const tools = figure.getByRole("group", { name: "Edit the picture" });
  const shownSize = () => figure.getByRole("img", { name: "Front cover" }).evaluate((img) => ({ src: img.src.slice(0, 5), w: img.naturalWidth, h: img.naturalHeight }));
  // V33.2: turning shows at once — the turned picture is made on the computer, then saved in the background.
  const t0 = Date.now();
  await tools.getByRole("button", { name: "Rotate right" }).click();
  let shownNow = await shownSize();
  for (let i = 0; i < 10 && !(shownNow.w === tall.height && shownNow.h === tall.width); i++) { await sleep(100); shownNow = await shownSize(); }
  check("Rotate right: shown turned at once, before it's saved", shownNow.src === "blob:" && shownNow.w === tall.height && shownNow.h === tall.width && Date.now() - t0 < 2500, JSON.stringify([shownNow, Date.now() - t0]));
  const turned = await waitForSize((z) => z && z.width === tall.height);
  check("…then saved, turned a quarter (width and height swap)", turned && turned.width === tall.height && turned.height === tall.width, JSON.stringify([tall, turned]));
  check("…and says so", await visible(figure.getByRole("status", { name: "Picture saving" }).getByText("✓ Saved")));
  await tools.getByRole("button", { name: "Rotate left" }).click();
  await tools.getByRole("button", { name: "Rotate left" }).click();
  await tools.getByRole("button", { name: "Rotate right" }).click();
  const back = await waitForSize((z) => z && z.width === tall.width);
  await sleep(1500);
  const settled = await coverSize();
  check("quick taps (left, left, right) saved in order: back upright", back && settled.width === tall.width && settled.height === tall.height, JSON.stringify(settled));

  // The full editor: the same as covers in Sections — corners, straighten and crop — in a full-screen view.
  await tools.getByRole("button", { name: "Edit picture" }).click();
  const editor = pc.getByRole("dialog", { name: /Edit the front cover of/ });
  check("Edit picture: a full-screen editor opens", await visible(editor) && await visible(editor.getByRole("button", { name: "Top-left corner" })));
  const inside = editor.getByRole("group", { name: "Edit the picture" });
  const editorImg = editor.getByRole("img", { name: "The photo taken" });
  const shapeBefore = await editorImg.evaluate((i) => [i.naturalWidth, i.naturalHeight]);
  await inside.getByRole("button", { name: "Rotate right" }).click();
  await sleep(400);
  const shapeAfter = await editorImg.evaluate((i) => [i.naturalWidth, i.naturalHeight]);
  check("…turning in the editor shows at once", shapeAfter[0] === shapeBefore[1] && shapeAfter[1] === shapeBefore[0], JSON.stringify([shapeBefore, shapeAfter]));
  await inside.getByRole("button", { name: "Rotate left" }).click();
  await editor.getByRole("button", { name: "Cancel" }).click();
  check("Cancel: closes, nothing saved", await editor.waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false) && JSON.stringify(await coverSize()) === JSON.stringify(settled));
  await tools.getByRole("button", { name: "Edit picture" }).click();
  await visible(editor.getByRole("button", { name: "Top-left corner" }));
  await sleep(1500); // let the edge-finding finish
  await inside.getByRole("button", { name: "Whole picture" }).click();
  // Crop to the middle: every corner dragged 20% in (one corner alone only tilts the shape,
  // and straightening that keeps the longest edges' full size).
  const frame = await editorImg.boundingBox();
  for (const [name, fx, fy] of [["Top-left", 0.2, 0.2], ["Top-right", 0.8, 0.2], ["Bottom-right", 0.8, 0.8], ["Bottom-left", 0.2, 0.8]]) {
    const hb = await editor.getByRole("button", { name: `${name} corner` }).boundingBox();
    await pc.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await pc.mouse.down();
    await pc.mouse.move(frame.x + frame.width * fx, frame.y + frame.height * fy, { steps: 8 });
    if (name === "Top-left") {
      // V33.3: near the top the magnifier goes below the finger, inside the picture — not off its top.
      const loupe = await editor.locator("[aria-hidden][style*='background-image']").boundingBox();
      check("magnifier on a top corner: below the finger, inside the picture", loupe && loupe.y >= frame.y - 1 && loupe.y > frame.y + frame.height * fy && loupe.x >= frame.x - 1, JSON.stringify({ loupe, frame }));
    }
    await pc.mouse.up();
  }
  await editor.getByRole("button", { name: "Save picture" }).click();
  check("Save picture: the editor closes", await editor.waitFor({ state: "detached", timeout: 15000 }).then(() => true, () => false));
  const cropped = await waitForSize((z) => z && z.width < tall.width * 0.8);
  check("…and the picture is cropped to the corners (about 60% each way)", cropped && Math.abs(cropped.width / tall.width - 0.6) < 0.06 && Math.abs(cropped.height / tall.height - 0.6) < 0.06, JSON.stringify([tall, cropped]));
  await tools.getByRole("button", { name: "Undo last change" }).click();
  const undone = await waitForSize((z) => z && z.width === tall.width);
  check("Undo last change: the whole picture is back", undone && undone.width === tall.width && undone.height === tall.height, JSON.stringify(undone));
  check("…and Undo goes (one step only)", await tools.getByRole("button", { name: "Undo last change" }).waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false));

  // Reporting from the computer (V28): the back photo, the AI's answer and the text now go to the Photo log.
  await pc.getByRole("button", { name: "Report a problem" }).click();
  const pcReport = pc.getByRole("region", { name: "Report a problem" });
  await pcReport.getByLabel(/What went wrong/).fill("viimeinen lause puuttuu");
  await pcReport.getByRole("button", { name: "Send report" }).click();
  check("computer: report sent", await visible(pcReport.getByText(/✓ Reported/), 15000));
  const logged = sql("SELECT error, ocr_text, photo_key FROM photo_log WHERE screen = '/extract/saved'");
  check("…in the Photo log with the back photo, the note, the answer and the text now", logged.length === 1 && logged[0].photo_key && /viimeinen lause puuttuu/.test(logged[0].error) && /— What came back —\nVäinö Linnan/.test(logged[0].ocr_text) && /— The text now —/.test(logged[0].ocr_text) && /Stopped because: stop/.test(logged[0].ocr_text), JSON.stringify(logged).slice(0, 400));
  const logView = await pcCtx.newPage();
  await logView.goto("/photo-log");
  check("…shown there as reported on the computer, with the photo", await visible(logView.getByRole("listitem").filter({ hasText: "Extract: reported on the computer" }).getByRole("img", { name: "Photo" })));
  await logView.close();

  // Copy on the computer (kept).
  const first = list.getByRole("button").last(); // the older one (the corrected text)
  await first.click();
  await pc.getByRole("button", { name: "Copy", exact: true }).click();
  check("Copy copies the selected text", (await pc.evaluate(() => navigator.clipboard.readText())).includes("kaksi miljoonaa"));

  // Correcting on the computer.
  const editBox = pc.getByRole("region", { name: "Selected text" }).getByLabel("Text");
  await editBox.fill((await editBox.inputValue()).replace("Väinö Linnan romaani", "Väinö Linnan rakastettu romaani"));
  check("computer: correction saves by itself", await visible(pc.getByRole("status", { name: "Correction" }).getByText(/Correction saved/), 10000));
  const corrected = rows().find((r) => r.text.includes("rakastettu"));
  check("…stored, marked as corrected on the computer", corrected && sql(`SELECT edited_on_computer_at FROM saved_texts WHERE id = '${corrected.id}'`)[0].edited_on_computer_at, JSON.stringify(rows()));
  await pc.waitForTimeout(6000); // a refresh or two
  check("…and the refresh doesn't undo it", (await editBox.inputValue()).includes("rakastettu"));
  await pc.getByRole("button", { name: "Copy", exact: true }).click();
  check("Copy copies the corrected text", (await pc.evaluate(() => navigator.clipboard.readText())).includes("rakastettu"));
  await editBox.fill("   ");
  check("emptying it is refused (Delete is for that)", await visible(pc.getByRole("status", { name: "Correction" }).getByText(/can't be empty/), 10000));
  check("…and the text is kept", rows().some((r) => r.text.includes("rakastettu")));
  await editBox.fill(corrected.text);
  await visible(pc.getByRole("status", { name: "Correction" }).getByText(/Correction saved/), 10000);

  // The phone's current text corrected on the computer, then the phone types: the computer's version stays.
  await list.getByRole("button").first().click();
  await editBox.fill((await editBox.inputValue()) + "\n\nKoneella lisätty lause.");
  await visible(pc.getByRole("status", { name: "Correction" }).getByText(/Correction saved/), 10000);
  await box.fill((await box.inputValue()) + " Puhelimella lisätty.");
  check("phone: says it's been corrected on the computer, not saved here", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/corrected on the computer, so changes here aren't saved/), 15000));
  await sleep(1000);
  check("…and the computer's version is kept", rows().some((r) => r.text.includes("Koneella lisätty")) && !rows().some((r) => r.text.includes("Puhelimella lisätty")));
  await list.getByRole("button").last().click();

  // V34: the ISBN button in place of Mark done — the number, copied with a click.
  check("no Mark done any more", (await pc.getByRole("button", { name: /Mark done/ }).count()) === 0);
  const selectedId = rows().find((r) => r.text.includes("rakastettu"))?.id ?? rows()[0].id;
  sql(`UPDATE saved_texts SET isbn = NULL WHERE id = '${selectedId}'`);
  await pc.reload();
  await list.getByRole("button").last().click();
  const isbnBtn = pc.getByRole("region", { name: "Selected text" }).getByRole("button", { name: /ISBN/ });
  check("no ISBN yet: the ISBN button says so, and can't be pressed", (await isbnBtn.innerText()) === "No ISBN" && await isbnBtn.isDisabled(), await isbnBtn.innerText());
  sql(`UPDATE saved_texts SET isbn = '9789510230763', isbn_source = 'barcode'`);
  await sleep(6000); // the list refreshes itself
  check("with an ISBN: shown on the button", (await isbnBtn.innerText()) === "978-951023076-3", await isbnBtn.innerText());
  await isbnBtn.click();
  check("…a click copies it", await visible(pc.getByRole("button", { name: /Copy ISBN/ }).getByText("ISBN copied ✓")) && (await pc.evaluate(() => navigator.clipboard.readText())) === "9789510230763");
  pc.once("dialog", (d) => d.accept());
  await pc.getByRole("button", { name: "Delete" }).click();
  await sleep(1000);
  check("Delete removes it", rows().length === 1 && (await list.getByRole("button").count()) === 1);
  check("…with its kept back photo", readings().length === 1 && readings()[0].text_id === rows()[0].id, JSON.stringify(readings()));

  // Big screen: list and text side by side.
  await list.getByRole("button").first().click();
  const layout = await pc.evaluate(() => {
    const l = document.querySelector("[aria-label='Saved texts']").getBoundingClientRect();
    const d = document.querySelector("[aria-label='Selected text']").getBoundingClientRect();
    return { side: l.right <= d.left, wide: d.width > 600, top: Math.abs(l.top - d.top) < 60 };
  });
  check("computer: list on the left, the text on the right", layout.side && layout.wide && layout.top, JSON.stringify(layout));
  await pc.screenshot({ path: ".wrangler/saved-desktop.png" });

  // On the phone: the list, then a tap opens one.
  await page.goto("/extract/saved");
  const plist = page.locator("[aria-label='Saved texts']");
  check("phone: the list (already logged in)", await visible(plist));
  check("phone: no text open yet", (await page.getByRole("region", { name: "Selected text" }).count()) === 0);
  await plist.getByRole("button").first().click();
  check("phone: tap opens it, list hidden", await visible(page.getByRole("region", { name: "Selected text" })) && !(await plist.isVisible()));
  await page.screenshot({ path: ".wrangler/saved-phone.png" });
  await page.getByRole("button", { name: "← All texts" }).click();
  check("phone: back to the list", await visible(plist));

  // No signal: waits on the phone, goes up later.
  await page.goto("/extract");
  await startOver();
  await take(["third"]);
  await page.waitForFunction(() => /Väinö/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 30000 });
  await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved —/), 15000);
  const before = rows().length;
  await page.context().setOffline(true);
  await box.fill((await box.inputValue()) + "\n\nLisätty ilman signaalia.");
  check("no signal: says it'll save later", await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/No signal — it'll be saved/), 15000));
  check("…not on the server yet", !rows().some((r) => r.text.includes("ilman signaalia")));
  const coversBefore = withCover().length;
  await page.getByLabel("Front cover photo").setInputFiles({ name: "COVER.jpg", mimeType: "image/jpeg", buffer: await frontCover(page, "#2f6a2f") });
  check("no signal: the front cover waits too, and says so", await visible(coverArea.getByText(/No signal — the front cover will be saved by itself/), 15000));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  let synced = false;
  for (let i = 0; i < 20 && !synced; i++) { await sleep(500); synced = rows().some((r) => r.text.includes("ilman signaalia")); }
  check("back online: saved by itself", synced && rows().length === before);
  let coverUp = false;
  for (let i = 0; i < 20 && !coverUp; i++) { await sleep(500); coverUp = withCover().length === coversBefore + 1; }
  check("…and the front cover goes up after it", coverUp, JSON.stringify(withCover()));
  check("computer: shows it", await visible(pc.locator("[aria-label='Saved texts']").getByRole("button", { name: /Väinö/ }).first(), 15000));

  // Kept 7 days after the last change (V27): one changed 8 days ago goes, 6 days ago stays.
  const daysAgo = (d) => new Date(Date.now() - d * 24 * 3600e3).toISOString();
  sql(`INSERT INTO saved_texts (id, text, source, created_at, updated_at) VALUES ('old-8-days', 'Kahdeksan päivää', 'ai', '${daysAgo(9)}', '${daysAgo(8)}'), ('old-6-days', 'Kuusi päivää', 'ai', '${daysAgo(9)}', '${daysAgo(6)}')`);
  const t1 = new Date().toISOString();
  await pc.request.put(`/api/extract/texts/${crypto.randomUUID()}`, { data: { text: "Uusi teksti.", source: "ai", createdAt: t1, updatedAt: t1 } });
  const ids = rows().map((r) => r.id);
  check("texts unchanged for over 7 days are deleted, newer kept", !ids.includes("old-8-days") && ids.includes("old-6-days"), JSON.stringify(ids));
  check("…and the page says 7 days", await visible(pc.getByText(/Kept for 7 days after their last change/)));

  // Many texts on a laptop screen (V27): the lists scroll inside themselves, the page doesn't.
  for (let i = 0; i < 30; i++) {
    const at = daysAgo(i / 24 + 0.01);
    const id = crypto.randomUUID();
    await pc.request.put(`/api/extract/texts/${id}`, { data: { text: `Teksti numero ${i + 1}, tarpeeksi pitkä kahdelle riville listassa.`, source: "ai", createdAt: at, updatedAt: at } });
    if (i % 3 === 0) await pc.request.patch(`/api/extract/texts/${id}`, { data: { done: true } });
  }
  await pc.setViewportSize({ width: 1366, height: 768 });
  await pc.reload();
  await visible(pc.getByRole("region", { name: "Selected text" }));
  await sleep(500);
  const fit = await pc.evaluate(() => ({
    page: document.documentElement.scrollHeight - innerHeight,
    lists: [...document.querySelectorAll("[aria-label='Saved texts'] ul")].map((u) => u.scrollHeight - u.clientHeight),
  }));
  check("laptop: the page itself doesn't scroll", fit.page <= 1, JSON.stringify(fit));
  check("…the To do and Done lists scroll inside themselves", fit.lists.length === 2 && fit.lists.every((x) => x > 100), JSON.stringify(fit));
  await pc.screenshot({ path: ".wrangler/saved-laptop.png" });

  // V31: the AI's answer gets lost on its way back (the page asleep while the camera is open):
  // the phone fetches it from the server, where every answer is kept.
  await startOver();
  let swallowed = 0;
  await page.route("**/api/extract", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch(); // the server reads it and keeps the answer…
    swallowed++; // …but the reply never reaches the page
  });
  await take(["lost"]);
  check("answer lost on the way: the phone gets it from the server instead", await page.waitForFunction(() => /Väinö/.test(document.querySelector("textarea")?.value ?? ""), null, { timeout: 20000 }).then(() => true, () => false) && swallowed === 1, String(swallowed));
  check("…read by AI, no phone-reader fallback", (await page.getByText(/so the phone did/).count()) === 0 && await visible(page.getByRole("status", { name: "Saved for the computer" }).getByText(/Saved —/), 15000));
  await page.unroute("**/api/extract");

  // V30: the front cover can be taken while the AI is still reading the back.
  await fetch(`${BOOKS}/__ai?mode=delay`, { method: "POST" });
  await startOver();
  await take(["fourth"]);
  check("while the AI reads: the seconds count up (V33.1)", await visible(page.getByLabel("Time so far")) && await page.waitForFunction(() => Number(document.querySelector("[aria-label='Time so far']")?.textContent.replace(/\D/g, "")) >= 1, null, { timeout: 5000 }).then(() => true, () => false));
  check("while the AI reads: the front cover button is offered", await visible(page.getByRole("button", { name: "Reading the text…" })) && await visible(coverArea.getByRole("button", { name: "Take a photo of the front cover" })));
  await page.getByLabel("Front cover photo").setInputFiles({ name: "COVER.jpg", mimeType: "image/jpeg", buffer: await frontCover(page, "#5a3a10") });
  check("…taken: it waits for the text", await visible(coverArea.getByText(/Front cover taken — it goes to the computer with the text/)));
  check("…while the AI is still reading", await page.getByRole("button", { name: "Reading the text…" }).isVisible());
  check("…then goes up with the text", await visible(coverArea.getByText("✓ Front cover saved for the computer"), 20000));
  const took = await page.getByLabel("Time taken").innerText().catch(() => "");
  check("phone: says how long the reading took (V33.1)", /in (\d+\.\d) s/.test(took) && Number(/in (\d+\.\d)/.exec(took)[1]) >= 3, took);
  const latest = sql("SELECT text, cover_key FROM saved_texts ORDER BY created_at DESC LIMIT 1")[0];
  check("…stored with that text", latest && latest.cover_key && /Väinö/.test(latest.text), JSON.stringify(latest));
  await fetch(`${BOOKS}/__ai?mode=ok`, { method: "POST" });

  await b.close();
  t.done();
})().catch(t.crash);
