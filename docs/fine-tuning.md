# Fine-tuning list

Things noticed in real use that need tuning. Each open
item says what was seen, the likely cause, and what to try. Add to the end;
move an item to `spec-corrections.md` once it's done.

## Done

- **1. Covered barcodes**, **2. pocket books** and **3. remembered camera
  settings** — built in V13; see `spec-corrections.md` §19. Still open from
  them:
  - **Pocket books: likely causes were low light and low picture quality.**
    The light and zoom are what helped in real use. Now the picture is
    sharper (more detail left after zooming in), and the light and zoom stay
    on once chosen. If some still won't scan, the remaining suspects are
    glossy or curved backs, or the aiming box being sized for full-size
    barcodes.
  - **Maybe later: recognise the cover with AI** (title and author off the
    cover, to fill in the search; the person picks the edition). Needs
    signal and an API key, and costs a little per photo.

## 4. Unconfirmed on a real phone: returning from Antikvaari on iPhone

**Seen:** not yet tested. The app notices you're back when the phone reports
the screen visible again; on some iPhones that may not fire when closing the
in-app Safari view (Done). If the camera doesn't restart, the book is shown
with "Scan next" instead — one tap. Check on an iPhone; if it's unreliable,
find another way to detect the return.
