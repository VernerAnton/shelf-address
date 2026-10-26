// A stand-in for the book services the lookup chain asks (Finna, Google Books,
// Open Library), answering from the recorded responses in lib/lookup/__fixtures__.
// run.sh starts it on 127.0.0.1:8790 and points the local Worker at it, so no
// test reaches the real services.
//
//   POST /__down?isbn=…&down=1   that ISBN's lookups fail (503 / 429) until down=0
//   GET  /__log                  every path asked, in order
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const FIX = path.join(__dirname, "../lib/lookup/__fixtures__");
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/**
 * A small real PNG cover with some texture: the app treats images under 1 kB
 * as "no cover" placeholders, and a flat colour compresses below that.
 */
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 40) - 20;
  const rows = [];
  for (let y = 0; y < h; y++) {
    rows.push(Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => Math.max(0, Math.min(255, [r, g, b][i % 3] + noise() + (y >> 2)))));
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const cover = png(120, 180, [150, 60, 40]);

const DOWN = new Set();
const log = [];

http
  .createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const p = url.pathname;
    if (p === "/__down") {
      const isbn = url.searchParams.get("isbn");
      if (url.searchParams.get("down") === "1") DOWN.add(isbn); else DOWN.delete(isbn);
      return json(res, 200, { down: [...DOWN] });
    }
    if (p === "/__log") return json(res, 200, log);
    log.push(p + url.search);
    if (p.startsWith("/Cover/") || p.startsWith("/img/")) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(cover);
    }
    // Finna: ISBN search, title search, one record.
    if (p === "/v1/search") {
      const isbn = url.searchParams.get("type") === "ISN" ? url.searchParams.get("lookfor") : null;
      if (isbn) {
        if (DOWN.has(isbn)) return json(res, 503, {});
        const f = `finna-isbn-${isbn}.json`;
        if (!fs.existsSync(path.join(FIX, f))) return json(res, 200, { resultCount: 0, records: [], status: "OK" });
        return json(res, 200, fixture(f));
      }
      return json(res, 200, fixture("finna-search-sinuhe.json"));
    }
    if (p === "/v1/record") return json(res, 200, fixture("finna-record-keski.334708.json"));
    // Google Books.
    if (p === "/books/v1/volumes") {
      const isbn = (url.searchParams.get("q") || "").replace("isbn:", "");
      if (DOWN.has(isbn) || isbn === "9780140328721") return json(res, 429, { error: { code: 429 } });
      if (isbn === "9780007156320") {
        const body = fixture("google-9780007156320.synthetic.json");
        body.items[1].volumeInfo.imageLinks = { thumbnail: `${BASE}/img/coelho.png` };
        return json(res, 200, body);
      }
      return json(res, 200, { totalItems: 0 });
    }
    // Open Library: edition by ISBN, author, covers.
    if (p.startsWith("/isbn/")) {
      const isbn = p.slice(6, 19);
      if (DOWN.has(isbn)) return json(res, 503, {});
      if (isbn === "9780140328721") {
        const body = fixture("openlibrary-isbn-9780140328721.json");
        body.covers = [];
        return json(res, 200, body);
      }
      return json(res, 404, {});
    }
    if (p.startsWith("/authors/")) return json(res, 200, fixture("openlibrary-author-OL34184A.json"));
    if (p.startsWith("/b/")) {
      res.writeHead(404);
      return res.end();
    }
    json(res, 404, {});
  })
  .listen(PORT, "127.0.0.1", () => console.log("mock books on", BASE));
