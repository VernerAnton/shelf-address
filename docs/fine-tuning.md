# Fine-tuning list

Things noticed in real use that need tuning. Nothing here is built yet — each
item says what was seen, the likely cause, and what to try. Add to the end;
move an item to `spec-corrections.md` once it's done.

## 1. Barcodes covered by recycling-shop stickers

**Seen:** books bought from recycling shops often have the shop's own price
sticker over the barcode, so there's nothing to scan.

**To try, in this order:**

- **Read the ISBN from the copyright page.** Almost every book prints its
  ISBN as text on the back of the title page (Finnish books: "ISBN 978-951-…"
  near the printer's details). Text recognition on the phone, from a photo of
  that page. Reliable because a misread ISBN fails its check digit and is
  rejected rather than giving the wrong book. Works offline; a one-time
  download of a few MB.
- **"Search by title" on Evaluate.** A text box that opens Antikvaari's search
  (`hakukone?q=<text>`) with whatever is typed. Small, and useful straight
  away for covered barcodes.
- **Later, maybe: recognise the cover with AI.** A vision model reads the
  title and author off the cover reliably; the exact edition it can't know,
  so it would only fill in the search (Finna on Scan, Antikvaari on Evaluate)
  and the person picks. Needs signal and an API key, and costs a little per
  photo.

## 2. Pocket books ("pokkarit") don't scan

**Seen:** pocket books' barcodes don't scan; their barcodes are physically
smaller.

**Likely causes:**

- **Too few pixels per bar** — the camera runs at 1280×720; a small barcode
  at normal distance may be too coarse. Try asking for 1920×1080.
- **Focus distance** — getting close enough to make the barcode big hits the
  camera's closest-focus limit. Zoom is the workaround; if it helps, consider
  a hint or zoom on by default.
- **Aiming box sized for full-size barcodes** — try reading only the centre
  of the frame, magnified.
- **Something about the books themselves** — glossy or curved backs, or a
  price add-on printed very close to the barcode.

**Needed to diagnose:** a photo of a problem pocket book's barcode (with the
phone's normal camera), which phone, and whether zoom, the lens button or
"Take a photo of the barcode" made a difference.

## 3. Remember camera settings when coming back

**Seen:** after going to Antikvaari and coming back, the camera restarts
with default settings — zoom back to 1×, light off.

**Want:** the camera comes back as it was left: same zoom (e.g. 2×), light
still on. The lens choice is already remembered; zoom and light should be too.

**Notes:** the camera is fully released while away (it has to be, or the
phone can't hand it to anything else), so the light goes off with it. Store
zoom and light on the phone when they're changed, and re-apply them once the
camera is running again. Decide whether this applies only when returning
(Evaluate) or every time the camera starts, on every scanning screen —
probably every time, so scanning always picks up where it was.

## 4. Unconfirmed on a real phone: returning from Antikvaari on iPhone

**Seen:** not yet tested. The app notices you're back when the phone reports
the screen visible again; on some iPhones that may not fire when closing the
in-app Safari view (Done). If the camera doesn't restart, the book is shown
with "Scan next" instead — one tap. Check on an iPhone; if it's unreliable,
find another way to detect the return.
