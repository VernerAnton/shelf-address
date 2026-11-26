// A stand-in for the book services the lookup chain asks (Finna, Google Books,
// Open Library), answering from the recorded responses in lib/lookup/__fixtures__.
// run.sh starts it on 127.0.0.1:8790 and points the local Worker at it, so no
// test reaches the real services.
//
//   POST /__down?isbn=…&down=1   that ISBN's lookups fail (503 / 429) until down=0
//   GET  /__log                  every path asked, in order
//
// Also OpenRouter, for Extract's AI reading (/api/v1/chat/completions), so
// tests never reach the real AI or spend anything:
//   POST /__ai?mode=ok|limit|badkey|slow|length|delay|picky   how it answers next (default ok;
//                                          length: stops early, out of room; delay: 3 s;
//                                          picky: refuses the reasoning setting;
//                                          nonone: refuses only effort "none";
//                                          cutoff: stops part-way with an error, all but the default)
//   GET  /__ai                             the requests it got (model, prompt, image size)
// BookOps asks the same stand-in (x-title "Shelf-Address BookOps") and gets JSON back:
//   POST /__ai?book=plain|isbn|badisbn|garbage   what it "reads" next (default plain:
//                                                title, author, back-cover text, no ISBN)
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PORT = Number(process.env.E2E_BOOKS_PORT) || 8790; // run-fast.cjs gives each worker its own
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
const AI_KEY = "test-openrouter-key";
const AI_TEXT = "Väinö Linnan romaani kertoo suomalaisesta konekiväärikomppaniasta jatkosodassa.\n\nTeos on myyty yli miljoona kappaletta.";
let aiMode = "ok";
let aiIsbn = "found";
let aiBook = "plain";
const aiRequests = [];
// What the stand-in "reads" off a BookOps book's photos.
const BOOKOPS = {
  plain: { title: "Tuntematon sotilas", author: "Väinö Linna", isbn: null, description: AI_TEXT },
  // An ISBN the stand-in Finna knows (Pääkallokehrääjä): the lookup then replaces the AI's title.
  isbn: { title: "Paakallokehraaja (AI)", author: "Remes", isbn: "ISBN 951-0-23076-6", description: AI_TEXT },
  // One digit misread: fails the check digit, so it must be dropped.
  badisbn: { title: "Kotimaan linnut", author: null, isbn: "978-951-0-23076-4", description: AI_TEXT },
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function chat(req, res) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const content = body.messages?.[0]?.content ?? [];
  const image = content.find((c) => c.type === "image_url")?.image_url?.url ?? "";
  const jpeg = Buffer.from(image.split(",")[1] ?? "", "base64");
  // JPEG size from its SOF marker, so tests can check the photo was made smaller.
  let width = 0, height = 0;
  for (let i = 2; i < jpeg.length - 9; ) {
    if (jpeg[i] !== 0xff) break;
    const marker = jpeg[i + 1], len = jpeg.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) { height = jpeg.readUInt16BE(i + 5); width = jpeg.readUInt16BE(i + 7); break; }
    i += 2 + len;
  }
  aiRequests.push({
    auth: req.headers.authorization,
    title: req.headers["x-title"],
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    reasoning: body.reasoning,
    provider: body.provider,
    prompt: content.find((c) => c.type === "text")?.text ?? "",
    imageType: image.slice(5, image.indexOf(";")),
    imageBytes: jpeg.length,
    width,
    height,
    images: content.filter((c) => c.type === "image_url").length,
  });
  if (req.headers.authorization !== `Bearer ${AI_KEY}` || aiMode === "badkey") return json(res, 401, { error: { message: "No auth credentials found" } });
  if (aiMode === "limit") return json(res, 402, { error: { message: "Key limit exceeded" } });
  if (aiMode === "slow") return; // never answers: the app's timeout has to handle it
  // Extract's ISBN reading (V34): digits only — or NONE with ?isbn=none.
  if (req.headers["x-title"] === "Shelf-Address Extract ISBN") {
    return json(res, 200, { model: body.model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: aiIsbn === "none" ? "NONE" : "9789510230763" } }] });
  }
  if (req.headers["x-title"] === "Shelf-Address BookOps") {
    const answer = aiBook === "garbage" ? "Sorry, I can't make out these photos." : "```json\n" + JSON.stringify(BOOKOPS[aiBook] ?? BOOKOPS.plain) + "\n```";
    return json(res, 200, { choices: [{ message: { role: "assistant", content: answer } }] });
  }
  if (aiMode === "delay") await new Promise((r) => setTimeout(r, 3000)); // a slow but fine answer
  if (aiMode === "picky" && body.reasoning) return json(res, 400, { error: { message: "Reasoning is mandatory / unsupported for this model" } });
  // Stops part-way with an error, as Flash-Lite and 3.6 Flash did in the shop (all but the default).
  if (aiMode === "cutoff" && body.model !== "google/gemini-3.8-flash:nitro") {
    return json(res, 200, {
      model: body.model,
      provider: "Google AI Studio",
      choices: [{ finish_reason: "error", native_finish_reason: "RECITATION", error: { message: "Model stopped: recitation", code: 502 }, message: { role: "assistant", content: AI_TEXT.split(" ").slice(0, 6).join(" ") } }],
    });
  }
  if (aiMode === "nonone" && body.reasoning?.effort === "none") return json(res, 400, { error: { message: "Reasoning is mandatory for this model" } });
  const usage = (answer, thinking) => ({ prompt_tokens: 1290, completion_tokens: answer, completion_tokens_details: { reasoning_tokens: thinking } });
  if (aiMode === "length") {
    return json(res, 200, {
      model: body.model,
      provider: "Google AI Studio",
      choices: [{ finish_reason: "length", message: { role: "assistant", content: AI_TEXT.split(" ").slice(0, 5).join(" ") } }],
      usage: usage(body.max_tokens, body.max_tokens - 12),
    });
  }
  json(res, 200, {
    model: body.model,
    provider: "Google AI Studio",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: "```\n" + AI_TEXT + "\n```" } }],
    usage: usage(640, 590),
  });
}

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
    if (p === "/__ai") {
      if (req.method === "POST") {
        if (url.searchParams.has("book")) aiBook = url.searchParams.get("book");
        else if (url.searchParams.has("isbn")) aiIsbn = url.searchParams.get("isbn");
        else aiMode = url.searchParams.get("mode") || "ok";
      }
      return json(res, 200, { mode: aiMode, book: aiBook, requests: aiRequests });
    }
    if (p === "/api/v1/chat/completions" && req.method === "POST") return void chat(req, res);
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
