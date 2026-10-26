# End-to-end tests

Real (headless) Chromium against the app running locally (`wrangler dev`),
with a fresh local database per suite and a stand-in for the book services
(`mock-books.cjs`, answering from `lib/lookup/__fixtures__`). Nothing touches
production or the real Finna / Google Books / Open Library / Antikvaari.

```sh
npx opennextjs-cloudflare build      # after changing the app
bash e2e/run.sh                      # every suite
bash e2e/run.sh e2e-scan.cjs         # one
bash e2e/serve.sh places             # just start it, to poke at by hand (stop: bash e2e/serve.sh stop)
```

- `lib.cjs` — shared helpers (`suite`, `sql`, `phone`, `choosePlace`, `kvPut`…).
- `videos.cjs` — fake camera scenes (a book barcode, no barcode, a cover),
  drawn in code and cached in `e2e/.cache/`.
- `fixtures/` — database seeds. A suite's first line picks one:
  `// seed: places` (default), `// seed: none`, `// seed: shelves`.

| Suite | What it covers |
|---|---|
| e2e-sections | places tree, addresses and their warnings, edit, order, move, delete, A–Z |
| e2e-panels | instruction panels, site maps |
| e2e-scan | camera and typed scans, condition, undo, offline queue, book page |
| e2e-lookup | Finna → Google → Open Library, covers, not found, services down, no-barcode books, catalog |
| e2e-wrongbook | wrong book behind a barcode, condition, moving and removing a copy |
| e2e-scroll | long lists scroll to their end (place picker, Finna results) |
| e2e-cover | cover camera (OpenCV), corners, by-hand covers never replaced, offline |
| e2e-review | review mode, missing copies, "is this that copy?" |
| e2e-evaluate | Evaluate switches, return detection, typing, title search |
| e2e-camera-help | weak cameras (simulated Galaxy A26), zoom/light remembered, printed ISBNs |
| e2e-photo-log | photo log, reader recovery, lost photos |
| e2e-extract | Extract: reading, tidying, sharing, copying |
| e2e-nav | the bottom rows |
| e2e-launch | installed app opening on Evaluate |
| e2e-update | update prompt, service worker, offline pages |

These live in the repository on purpose: the cloud sessions this app is built
in are reset now and then, and anything outside the repository goes with them.
