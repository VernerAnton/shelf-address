// seed: places
// Update prompt and service worker (CLAUDE.md "Update detection"): the page
// compares its own build with /api/version and offers a reload — never reloads
// by itself. A newer deploy is imitated by answering /api/version with another
// build id.
const { suite, browser, phone, visible, sleep, APP_VERSION } = require("./lib.cjs");

// Headless Chromium never fires visibilitychange itself: run the page's own
// handler as the browser would when the app is switched back to.
const becomeVisible = (page) => page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});

const t = suite();
(async () => {
  const { check } = t;
  const b = await browser();
  const page = await phone(b, t);
  const ctx = page.context();
  const prompt = page.getByRole("status").filter({ hasText: /A newer version/ });

  await page.goto("/sections/new");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 }).catch(() => {});
  const sw = await page.evaluate(async () => ({ scope: (await navigator.serviceWorker.getRegistration())?.scope, controller: navigator.serviceWorker.controller?.scriptURL }));
  check("service worker registered for the whole app", sw.scope === "http://127.0.0.1:8788/", JSON.stringify(sw));
  check("page controlled by it", sw.controller === "http://127.0.0.1:8788/sw.js", JSON.stringify(sw));
  check(`version stamp shows V${APP_VERSION}`, await visible(page.getByText(`V${APP_VERSION}`, { exact: true })));
  await becomeVisible(page);
  await sleep(1500);
  check("same build: no prompt", (await prompt.count()) === 0);

  // A newer deploy (with a version bump).
  let answer = { version: APP_VERSION + 1, buildId: "newer-build" };
  await ctx.route("**/api/version", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(answer) }));
  await page.getByRole("textbox", { name: "Name" }).fill("Half-typed name");
  await page.evaluate(() => { window.__sameDocument = true; });
  await becomeVisible(page);
  check("newer build: offers a reload, naming the version", await visible(prompt.getByText(`A newer version (V${APP_VERSION + 1}) is ready.`)));
  check("…and the one in use", await visible(prompt.getByText(`You're on V${APP_VERSION}.`)));
  await sleep(2000);
  check("never reloads by itself (the half-typed form survives)", (await page.evaluate(() => window.__sameDocument)) === true && (await page.getByRole("textbox", { name: "Name" }).inputValue()) === "Half-typed name");

  await prompt.getByRole("button", { name: "Later" }).click();
  check("'Later' hides it", (await prompt.count()) === 0);
  await becomeVisible(page);
  check("…back on the next return to the app", await visible(prompt));
  await prompt.getByRole("button", { name: "Later" }).click();
  await ctx.setOffline(true);
  await becomeVisible(page);
  check("…even with no signal to re-confirm it", await visible(prompt));
  await ctx.setOffline(false);

  // A deploy that forgot the version bump still counts.
  answer = { version: APP_VERSION, buildId: "same-number-new-build" };
  await prompt.getByRole("button", { name: "Reload" }).click();
  await page.waitForLoadState("load");
  check("Reload reloads", (await page.evaluate(() => window.__sameDocument)) !== true);
  await becomeVisible(page);
  check("new build, same number: still offered (without a number)", await visible(prompt.getByText("A newer version is ready.", { exact: true })));

  // Back to the real answer: no prompt after reloading.
  await ctx.unroute("**/api/version");
  await page.reload();
  await becomeVisible(page);
  await sleep(1500);
  check("up to date after reload: no prompt", (await prompt.count()) === 0);

  // Offline: pages seen before still open; the version check is never cached.
  await page.goto("/sections");
  await page.goto("/evaluate");
  await sleep(1000);
  await ctx.setOffline(true);
  await page.goto("/sections").catch(() => {});
  check("offline: a page seen before still opens", await visible(page.getByRole("heading", { name: "Sections" })));
  await page.goto("/catalog?q=never-seen").catch(() => {});
  check("offline: an unseen page says there's no signal", await visible(page.getByText(/No signal/)));
  await ctx.setOffline(false);
  const cached = await page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    return urls;
  });
  check("/api/version never cached", !cached.some((u) => u.startsWith("/api/")), JSON.stringify(cached.filter((u) => u.startsWith("/api"))));

  await b.close();
  t.done();
})().catch(t.crash);
