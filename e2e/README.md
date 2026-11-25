# End-to-end tests

Real (headless) Chromium against the app running locally (`wrangler dev`),
with a fresh local database per suite and a stand-in for the outside services
(`mock-books.cjs`: the book lookups, answering from `lib/lookup/__fixtures__`,
and OpenRouter for Extract's and BookOps' AI). Nothing touches production or the real
Finna / Google Books / Open Library / Antikvaari / OpenRouter, and nothing is
spent. The local app gets the access code `test-code`.

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
| e2e-extract | Extract: reading on the phone, tidying, sharing, copying |
| e2e-extract-ai | Extract's AI reading: access code, OpenRouter (stand-in), phone fallback |
| e2e-saved-texts | Saved texts: phone to computer, corrections on either, Copy/Download/Done/Delete, offline, layouts |
| e2e-bookops | BookOps: the Extract tab's two options, camera (Space, stop/start), barcode, databases and AI filling in, typed text kept, photos added to an open book, same-ISBN tags, price check links, web store (stand-in), phone as the ISBN scanner and the camera (Needs photos, back-cover photos), computer camera off by default |
| e2e-nav | the bottom rows |
| e2e-launch | installed app opening on Evaluate |
| e2e-update | update prompt, service worker, offline pages |

These live in the repository on purpose: the cloud sessions this app is built
in are reset now and then, and anything outside the repository goes with them.

## Fast: several suites at once

    node e2e/run-fast.cjs                    # every suite, 3 at a time — about 5 minutes
    node e2e/run-fast.cjs -j 2 e2e-scan.cjs  # just these

Each of the workers has its own app server (127.0.0.1:8800, 8810, 8820…), its
own book-service stand-in (8801, 8811…) and its own local database
(`.wrangler/e2e-w<k>`); the suites find them through `E2E_BASE`, `E2E_BOOKS`
and `E2E_PERSIST` (unset under run.sh, which uses 8788/8790 and the usual
local database). The slowest suites start first, by the times kept in
`.wrangler/e2e-times.json`. A worker only ever stops what it started.

Three at a time is what this machine (4 processors) takes: the suites that
work on photos in the browser get slow under load, and their waits allow for
that. More workers would mostly make them wait for each other.

## One run at a time

Every `run.sh`/`serve.sh` run stops and restarts the one shared test server
on port 8788, run-fast.cjs's workers use their own fixed ports, and a build
replaces the app any of them serves. So never start a run, or build, while
another run is still going (a background full run included):
they knock each other's server over, and the failures look like real ones
(`ECONNREFUSED`, click timeouts, missing rows). Wait for it, or stop it first.
