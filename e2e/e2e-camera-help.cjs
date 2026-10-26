// seed: places
// Weak phone cameras (spec-corrections §18, §19): a simulated Galaxy A26 with
// three back lenses — the main lens chosen, autofocus, zoom, Full HD, zoom and
// light remembered; photos read with "try harder"; printed ISBNs read from a
// photo of the copyright page.
const { suite, browser, phone, visible, sql, sleep, choosePlace } = require("./lib.cjs");

// A Galaxy A26 as the browser sees it: front camera, and main / ultra-wide / macro on the back.
const A26 = () => {
  const list = [
    { deviceId: "front", label: "camera2 1, facing front" },
    { deviceId: "macro", label: "camera2 3, facing back" },
    { deviceId: "main", label: "camera2 0, facing back" },
    { deviceId: "wide", label: "camera2 2, facing back" },
  ];
  navigator.mediaDevices.enumerateDevices = async () => list.map((d) => ({ ...d, kind: "videoinput", groupId: d.deviceId, toJSON() { return this; } }));
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.__requests = []; window.__applied = []; window.__sizes = [];
  navigator.mediaDevices.getUserMedia = async (c) => {
    const id = c && c.video && c.video.deviceId ? c.video.deviceId.exact : null;
    window.__requests.push(id);
    window.__sizes.push(c && c.video && c.video.width ? `${c.video.width.ideal}x${c.video.height.ideal}` : null);
    const stream = await real({ video: true });
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings.bind(track);
    let zoom = 1;
    track.getSettings = () => ({ ...settings(), deviceId: id || "main", zoom });
    track.getCapabilities = () => ({ zoom: { min: 1, max: 10, step: 0.1 }, focusMode: ["continuous", "manual"], torch: true });
    track.applyConstraints = async (x) => { window.__applied.push(JSON.stringify(x)); const a = x && x.advanced && x.advanced[0]; if (a && a.zoom) zoom = a.zoom; };
    return stream;
  };
};

const t = suite();
(async () => {
  const { check } = t;
  {
    const b = await browser("book");
    const page = await phone(b, t);
    await page.context().addInitScript(A26);
    await page.goto("/scan");
    await choosePlace(page, "Store", "Wall unit", "Row 2");
    await page.getByRole("button", { name: "Scan with camera" }).click();
    await visible(page.getByRole("button", { name: "Stop camera" }));
    const req = await page.evaluate(() => window.__requests);
    check("opens the main lens (camera2 0), not macro or ultra-wide", req[0] === "main", JSON.stringify(req));
    check("asks for Full HD (small pocket-book barcodes)", (await page.evaluate(() => window.__sizes))[0] === "1920x1080", JSON.stringify(await page.evaluate(() => window.__sizes)));
    check("asks for continuous autofocus", (await page.evaluate(() => window.__applied)).some((a) => a.includes('"focusMode":"continuous"')));
    check("scans with it", await visible(page.getByText("Logged 978-951036686-8"), 20000));
    check("hint about zooming", await visible(page.getByText(/Hold the book further away and zoom in/)));

    const zoom = page.getByRole("button", { name: /^Zoom/ });
    check("zoom button starts at 1×", (await zoom.innerText()).trim() === "1×");
    await zoom.click(); await sleep(200);
    check("zoom 2×", (await zoom.innerText()).trim() === "2×" && (await page.evaluate(() => window.__applied)).some((a) => a.includes('"zoom":2')));
    await zoom.click(); await sleep(200);
    check("zoom 3×", (await zoom.innerText()).trim() === "3×");
    await zoom.click(); await sleep(200);
    check("zoom back to 1×", (await zoom.innerText()).trim() === "1×");

    const lens = page.getByRole("button", { name: /^Switch lens/ });
    check("lens button: lens 1 of 3 (front camera not offered)", (await lens.innerText()).trim() === "Lens 1/3");
    await lens.click();
    await page.waitForFunction(() => window.__requests.includes("wide"), null, { timeout: 10000 }).catch(() => {});
    check("switch goes to the next lens (ultra-wide)", (await page.evaluate(() => window.__requests)).at(-1) === "wide");
    check("lens button: lens 2 of 3", await visible(page.getByRole("button", { name: /lens 2 of 3/ })));
    await page.reload();
    await page.getByRole("button", { name: "Scan with camera" }).click();
    await visible(page.getByRole("button", { name: "Stop camera" }));
    check("the chosen lens is remembered on the phone", (await page.evaluate(() => window.__requests))[0] === "wide", JSON.stringify(await page.evaluate(() => window.__requests)));
    check("light starts off", await visible(page.getByRole("button", { name: "Light", exact: true })));
    check("zoom starts at 1× when never changed", (await zoom.innerText()).trim() === "1×");

    // Zoom 2× and light on, then away and back: both come back.
    await zoom.click(); await sleep(200);
    await page.getByRole("button", { name: "Light", exact: true }).click(); await sleep(200);
    check("light on", await visible(page.getByRole("button", { name: "Light off" })));
    await page.reload();
    await page.getByRole("button", { name: "Scan with camera" }).click();
    await visible(page.getByRole("button", { name: "Stop camera" }));
    await sleep(500);
    const applied = await page.evaluate(() => window.__applied);
    check("zoom 2× comes back by itself", (await zoom.innerText()).trim() === "2×" && applied.some((a) => a.includes('"zoom":2')), JSON.stringify(applied));
    check("light comes back on by itself", (await page.getByRole("button", { name: "Light off" }).count()) === 1 && applied.some((a) => a.includes('"torch":true')));
    await page.getByRole("button", { name: "Light off" }).click(); await sleep(200);
    await zoom.click(); await zoom.click(); await sleep(200);
    await page.reload();
    await page.getByRole("button", { name: "Scan with camera" }).click();
    await visible(page.getByRole("button", { name: "Stop camera" }));
    await sleep(500);
    check("turned off and back to 1×: stays that way", (await zoom.innerText()).trim() === "1×" && (await page.getByRole("button", { name: "Light", exact: true }).count()) === 1 && !(await page.evaluate(() => window.__applied)).some((a) => a.includes('"torch":true') || a.includes('"zoom":')));
    await b.close();
  }
  {
    // Photos, on a camera that sees no book barcode.
    const b = await browser("notbook");
    const page = await phone(b, t);
    await page.goto("/scan");
    await choosePlace(page, "Store", "Wall unit", "Row 2");
    const count = (isbn) => sql(`SELECT COUNT(*) n FROM copies WHERE isbn13 = '${isbn}'`)[0].n;
    const before = count("9789510230763");
    // A big phone photo (3000×4000), taken sideways and a little blurry, of Pääkallokehrääjä's barcode.
    const photo = Buffer.from(await page.evaluate(() => {
      const code = "9789510230763";
      const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
      const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
      const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
      const P = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
      const d = code.split("").map(Number);
      let bits = "101"; for (let i = 1; i <= 6; i++) bits += (P[d[0]][i - 1] === "L" ? L : G)[d[i]];
      bits += "01010"; for (let i = 7; i <= 12; i++) bits += R[d[i]]; bits += "101";
      const bar = document.createElement("canvas"); bar.width = 95 * 9 + 200; bar.height = 600;
      const x0 = bar.getContext("2d"); x0.fillStyle = "#f4f1e8"; x0.fillRect(0, 0, bar.width, bar.height); x0.fillStyle = "#111";
      for (let i = 0; i < 95; i++) if (bits[i] === "1") x0.fillRect(100 + i * 9, 60, 9, 480);
      const c = document.createElement("canvas"); c.width = 3000; c.height = 4000;
      const x = c.getContext("2d"); x.fillStyle = "#6b5a48"; x.fillRect(0, 0, 3000, 4000);
      x.filter = "blur(2px)";
      x.translate(1500, 2000); x.rotate(Math.PI / 2); x.drawImage(bar, -bar.width / 2, -bar.height / 2);
      return c.toDataURL("image/jpeg", 0.85).split(",")[1];
    }), "base64");
    check("photo button offered", await visible(page.getByRole("button", { name: /Take a photo/ })));
    await page.getByLabel("Barcode photo").setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: photo });
    check("barcode read from a big, sideways, blurry photo", await visible(page.getByText("Logged 978-951023076-3"), 30000));
    await sleep(2500);
    check("…and logged", count("9789510230763") === before + 1);

    const blank = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 600; const x = c.getContext("2d"); x.fillStyle = "#888"; x.fillRect(0, 0, 800, 600); return c.toDataURL("image/jpeg").split(",")[1]; }), "base64");
    await page.getByLabel("Barcode photo").setInputFiles({ name: "IMG_0002.jpg", mimeType: "image/jpeg", buffer: blank });
    check("photo without a barcode or ISBN: explained", await visible(page.getByText(/Couldn't find a barcode or an ISBN in that photo/), 90000));

    // Barcode covered: a photo of the copyright page, read as text.
    const pagePhoto = (lines, turn = 0) => page.evaluate(([lines, turn]) => {
      const c = document.createElement("canvas"); c.width = 2400; c.height = 3200;
      const x = c.getContext("2d"); x.fillStyle = "#5a4a3a"; x.fillRect(0, 0, 2400, 3200);
      x.translate(1200, 1600); x.rotate((turn * Math.PI) / 180); x.translate(-1200, -1600);
      x.fillStyle = "#f6f2e6"; x.fillRect(300, 400, 1800, 2400);
      x.fillStyle = "#222"; x.font = "48px Georgia, serif";
      lines.forEach((l, i) => x.fillText(l, 400, 700 + i * 90));
      x.setTransform(1, 0, 0, 1, 0, 0);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    }, [lines, turn]).then((b64) => Buffer.from(b64, "base64"));
    const imprint = ["Suomentanut Juhani Lindholm", "© 2004 Kustannusosakeyhtiö Otava", "", "ISBN 978-951-0-23076-3", "", "Painettu EU:ssa"];
    const start = count("9789510230763");
    await page.getByLabel("Barcode photo").setInputFiles({ name: "IMG_0003.jpg", mimeType: "image/jpeg", buffer: await pagePhoto(imprint) });
    check("covered barcode: ISBN read from the copyright page", await visible(page.getByText("Logged 978-951023076-3").last(), 90000));
    let n = start;
    for (let i = 0; i < 30 && n === start; i++) { await sleep(1000); n = count("9789510230763"); }
    check("…and logged", n === start + 1);
    await page.getByLabel("Barcode photo").setInputFiles({ name: "IMG_0004.jpg", mimeType: "image/jpeg", buffer: await pagePhoto(imprint, 90) });
    let sideways = false;
    for (let i = 0; i < 90 && !sideways; i++) { await sleep(1000); sideways = count("9789510230763") === start + 2; }
    check("…also when the photo is sideways", sideways);

    // Several ISBNs on the page: asks which.
    const several = ["Otava 2010", "ISBN 978-951-0-23076-3 (sid.)", "ISBN 978-951-0-36686-8 (nid.)", "Painettu EU:ssa"];
    await page.getByLabel("Barcode photo").setInputFiles({ name: "IMG_0005.jpg", mimeType: "image/jpeg", buffer: await pagePhoto(several) });
    const choice = page.getByRole("region", { name: "ISBNs in the photo" });
    check("several ISBNs: asks which", await visible(choice, 90000));
    const options = choice.getByRole("button", { name: /978-951/ });
    const texts = (await options.allInnerTexts()).map((s) => s.replace(/\s+/g, " "));
    check("…listing both with their labels", texts.length === 2 && texts[0].includes("978-951023076-3") && texts[0].includes("sid.") && texts[1].includes("978-951036686-8") && texts[1].includes("nid."), JSON.stringify(texts));
    await options.nth(1).click();
    check("…and logs the one picked", await visible(page.getByText("Logged 978-951036686-8"), 15000));
    check("…choice list closes", (await choice.count()) === 0);

    // A laptop-like camera (no labelled back lens): no lens button.
    await page.getByRole("button", { name: "Scan with camera" }).click();
    await visible(page.getByRole("button", { name: "Stop camera" }));
    check("single camera: no lens button", (await page.getByRole("button", { name: /^Switch lens/ }).count()) === 0);
    await page.goto("/evaluate");
    check("photo button on Evaluate too", await visible(page.getByRole("button", { name: /Take a photo/ })));
    await b.close();
  }
  t.done();
})().catch(t.crash);
