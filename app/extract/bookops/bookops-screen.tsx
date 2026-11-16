"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConditionChips } from "@/components/condition-chips";
import { BookIcon } from "@/components/icons";
import {
  formatPrice,
  isWorking,
  needsCheck,
  QUEUE_LABEL,
  queueState,
  sourceLabel,
  type BookOpsBook,
  type FieldSource,
  type QueueState,
} from "@/lib/bookops-model";
import { STORE_IS_STAND_IN } from "@/lib/bookops-store";
import { bookOps, BookOpsApiError, readBarcode } from "@/lib/client/bookops";
import { formatIsbn, parseIsbn } from "@/lib/isbn";
import { PRICE_SITES, priceQuery } from "@/lib/price-sites";
import { LoginForm } from "../_components/login-form";
import { BookOpsCamera, type Shots } from "./bookops-camera";

/** How often the list checks for news while it's on screen: a book sent from a phone, a field filled in. */
const REFRESH_MS = 3000;
/** How long typing pauses before it's saved. */
const SAVE_AFTER_MS = 800;
/** A book still waiting to be read is given another push this often (the server makes sure only one does the work). */
const NUDGE_EVERY_MS = 20_000;

/** The fields typed at the desk, as text. */
type Field = "title" | "author" | "publisher" | "year" | "description" | "location" | "price" | "quantity" | "isbn";
type Typed = Partial<Record<Field, string>>;
type Notice = { kind: "ok" | "warn" | "error"; text: string };

const when = (iso: string) => new Date(iso).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const wide = () => window.matchMedia("(min-width: 1024px)").matches;
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

const PILL: Record<QueueState, string> = {
  reading: "bg-accent/10 text-accent",
  price: "bg-line/70 text-foreground",
  ready: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  listed: "bg-line/50 text-muted",
};

function Tag({ kind, children }: { kind: "good" | "warn" | "info" | "plain"; children: React.ReactNode }) {
  const look = {
    good: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    warn: "border border-warn-line bg-warn-bg text-warn-text",
    info: "bg-accent/10 text-accent",
    plain: "bg-line/70 text-foreground",
  }[kind];
  return <span className={`rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap ${look}`}>{children}</span>;
}

/** Where a field's text came from, beside its label. */
function SourceTag({ source, typed, reading }: { source: FieldSource | null; typed: boolean; reading: boolean }) {
  if (typed || source === "you") return <Tag kind="plain">Yours</Tag>;
  if (source === "ai") return <Tag kind="warn">{sourceLabel("ai")}</Tag>;
  if (source) return <Tag kind="good">{sourceLabel(source)}</Tag>;
  return reading ? <Tag kind="info">Reading…</Tag> : null;
}

/**
 * BookOps on a computer (docs/spec-corrections.md §27): one screen. The queue
 * on the left, the book being worked on in the middle, the camera on the
 * right. A book is photographed front and back (here, or on a phone); the
 * ISBN comes from the barcode, title and author from the book databases, the
 * back-cover text from the AI — each field saying where its text came from —
 * while the person picks the condition, checks prices on the sites and types
 * the price. Nothing fills in a field the person has typed in.
 *
 * Everything saves by itself. "Send to web store" lists the book as it stands.
 */
export function BookOpsScreen() {
  const [state, setState] = useState<"loading" | "login" | "ready" | "offline">("loading");
  const [books, setBooks] = useState<BookOpsBook[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** What's been typed into the open book: shown instead of the server's text, so news from the server never moves the cursor. */
  const [typed, setTyped] = useState<Typed>({});
  const [save, setSave] = useState<{ status: "idle" | "saving" | "saved" | "error"; error?: string }>({ status: "idle" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(0);
  const [busy, setBusy] = useState<"send" | "back" | null>(null);
  const [isbn, setIsbn] = useState("");
  const [isbnNote, setIsbnNote] = useState<string | null>(null);

  const selectedRef = useRef<string | null>(null);
  const typedRef = useRef<Typed>({});
  /** What the server already has of `typed`. */
  const sentRef = useRef<Typed>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Saves happen one after another, so an older one can't land on top of a newer one. */
  const savingRef = useRef<Promise<void>>(Promise.resolve());
  const nudgedRef = useRef<Record<string, number>>({});

  const put = useCallback((book: BookOpsBook) => setBooks((all) => (all.some((b) => b.id === book.id) ? all.map((b) => (b.id === book.id ? book : b)) : [book, ...all])), []);

  /** Starts (or picks up) a book's lookup and AI reading; the answer is the book once they're done. */
  const nudge = useCallback(
    (id: string, retry = false) => {
      nudgedRef.current[id] = Date.now();
      void bookOps.process(id, retry).then(put, () => {});
    },
    [put],
  );

  const load = useCallback(async () => {
    try {
      const list = await bookOps.list();
      setBooks(list);
      setState("ready");
      // On a big screen, open the first book still to do.
      if (!selectedRef.current && wide()) {
        const first = list.find((b) => b.status === "draft") ?? null;
        if (first) {
          selectedRef.current = first.id;
          setSelected(first.id);
        }
      }
      for (const book of list) {
        if (isWorking(book) && Date.now() - (nudgedRef.current[book.id] ?? 0) > NUDGE_EVERY_MS) nudge(book.id);
      }
    } catch (e) {
      if (e instanceof BookOpsApiError && e.loggedOut) setState("login");
      else setState((s) => (s === "loading" ? "offline" : s));
    }
  }, [nudge]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  /** Saves what's been typed and not yet sent. Resolves when the server has it (or has refused it). */
  const saveNow = useCallback((): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const id = selectedRef.current;
    const now = typedRef.current;
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(now) as [Field, string][]) {
      if (sentRef.current[field] !== value) patch[field] = field === "quantity" ? Number(value.trim() || "x") : value;
    }
    if (!id || Object.keys(patch).length === 0) return savingRef.current;
    setSave({ status: "saving" });
    savingRef.current = savingRef.current.then(async () => {
      try {
        const book = await bookOps.edit(id, patch);
        put(book);
        if (selectedRef.current === id) {
          sentRef.current = { ...sentRef.current, ...now };
          setSave({ status: "saved" });
        }
        // A typed ISBN is looked up straight away.
        if ("isbn" in patch && isWorking(book)) nudge(id);
      } catch (e) {
        if (e instanceof BookOpsApiError && e.loggedOut) setState("login");
        if (selectedRef.current === id) setSave({ status: "error", error: message(e) });
      }
    });
    return savingRef.current;
  }, [put, nudge]);

  const type = (field: Field, value: string) => {
    typedRef.current = { ...typedRef.current, [field]: value };
    setTyped(typedRef.current);
    setSave({ status: "saving" });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void saveNow(), SAVE_AFTER_MS);
  };

  /** Opens another book (or none): what was typed in this one is saved first. */
  const open = useCallback(
    (id: string | null) => {
      void saveNow();
      selectedRef.current = id;
      typedRef.current = {};
      sentRef.current = {};
      setTyped({});
      setSelected(id);
      setSave({ status: "idle" });
    },
    [saveNow],
  );

  // Leaving the page: save what's pending.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void saveNow();
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [saveNow]);

  /** Both covers photographed here: store the book, open it, and let the reading start. */
  const onBook = useCallback(
    async ({ front, back, backCanvas }: Shots) => {
      const id = crypto.randomUUID();
      setAdding((n) => n + 1);
      setNotice(null);
      try {
        const barcode = await readBarcode(backCanvas);
        const book = await bookOps.add({ id, front, back, isbn: barcode, isbnSource: "barcode" });
        put(book);
        open(book.id);
        nudge(book.id);
        setNotice(
          barcode
            ? { kind: "ok", text: `Added to the queue. ISBN ${formatIsbn(barcode)} read from the barcode.` }
            : { kind: "warn", text: "Added to the queue. No barcode found in the back photo, so the AI is looking for the ISBN." },
        );
      } catch (e) {
        if (e instanceof BookOpsApiError && e.loggedOut) setState("login");
        setNotice({ kind: "error", text: `That book wasn't added (${message(e).replace(/\.$/, "")}). Photograph it again.` });
      } finally {
        setAdding((n) => n - 1);
      }
    },
    [put, open, nudge],
  );

  /** The ISBN box: a book by its ISBN alone, typed or from a hand-held reader. */
  const addIsbn = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseIsbn(isbn);
    if (!parsed.ok) return setIsbnNote(parsed.reason);
    setIsbnNote(null);
    try {
      const book = await bookOps.add({ id: crypto.randomUUID(), isbn: parsed.isbn13, isbnSource: "typed" });
      setIsbn("");
      put(book);
      open(book.id);
      nudge(book.id);
    } catch (err) {
      if (err instanceof BookOpsApiError && err.loggedOut) setState("login");
      setIsbnNote(message(err));
    }
  };

  if (state === "loading") return <p className="text-muted">Loading…</p>;
  if (state === "offline") return <p className="text-muted">No connection. BookOps works on the server — try again when you&apos;re online.</p>;
  if (state === "login") {
    return (
      <div className="max-w-md">
        <LoginForm label="BookOps needs the access code" hint="The same code as AI reading and Saved texts. Asked once in this browser." onLoggedIn={() => void load()} />
      </div>
    );
  }

  const book = books.find((b) => b.id === selected) ?? null;
  const todo = books.filter((b) => b.status === "draft");
  const listed = books.filter((b) => b.status === "listed");
  const locked = book?.status === "listed";

  const setCondition = async (b: BookOpsBook, condition: string | null) => {
    put({ ...b, condition: condition as BookOpsBook["condition"] });
    try {
      put(await bookOps.edit(b.id, { condition }));
    } catch (e) {
      setSave({ status: "error", error: message(e) });
    }
  };

  const send = async (b: BookOpsBook) => {
    setBusy("send");
    await saveNow();
    try {
      const sent = await bookOps.send(b.id);
      put(sent);
      // From here the book is shown as the web store has it.
      typedRef.current = {};
      sentRef.current = {};
      setTyped({});
      setSave({ status: "idle" });
      // On to the next book still to do.
      const next = books.find((x) => x.status === "draft" && x.id !== b.id);
      if (next && wide()) open(next.id);
    } catch (e) {
      setSave({ status: "error", error: message(e) });
    } finally {
      setBusy(null);
    }
  };

  const takeBack = async (b: BookOpsBook) => {
    setBusy("back");
    try {
      put(await bookOps.takeBack(b.id));
    } catch (e) {
      setSave({ status: "error", error: message(e) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (b: BookOpsBook) => {
    if (!window.confirm("Delete this book and its photos from BookOps? It can't be brought back.")) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    typedRef.current = {};
    setBooks((all) => all.filter((x) => x.id !== b.id));
    open(null);
    await bookOps.remove(b.id).catch(() => {});
    void load();
  };

  const row = (b: BookOpsBook) => {
    const s = queueState(b);
    return (
      <li key={b.id} className="border-b border-line last:border-0">
        <button
          type="button"
          onClick={() => open(b.id)}
          aria-current={b.id === selected ? "true" : undefined}
          className={`flex w-full gap-3 px-3 py-2.5 text-left ${b.id === selected ? "bg-accent/10" : "hover:bg-line/40"}`}
        >
          {b.frontPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.frontPhoto} alt="" loading="lazy" className="h-14 w-10 shrink-0 rounded bg-line/70 object-cover" />
          ) : (
            <span aria-hidden className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-line/70 text-muted">
              <BookIcon className="size-5" />
            </span>
          )}
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="flex flex-wrap items-center gap-1">
              <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${PILL[s]}`}>{QUEUE_LABEL[s]}</span>
              {s !== "listed" && s !== "reading" && needsCheck(b) && <Tag kind="warn">Check</Tag>}
            </span>
            <span className="w-full truncate text-sm font-medium">{b.title?.trim() || (b.isbn13 ? formatIsbn(b.isbn13) : s === "reading" ? "New book" : "Untitled book")}</span>
            <span className="w-full truncate text-xs text-muted">
              {b.priceCents !== null ? `${formatPrice(b.priceCents)} €` : "No price"}
              {b.author ? ` · ${b.author}` : ""}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const input = "h-10 w-full min-w-0 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent disabled:opacity-70";
  /** A text field of the open book: label, where its text came from, and the box. */
  const field = (b: BookOpsBook, name: "title" | "author" | "publisher" | "year", label: string) => {
    const source = b[`${name}Source`];
    const mine = name in typed;
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <label htmlFor={`bookops-${name}`}>{label}</label>
          <SourceTag source={source} typed={mine} reading={isWorking(b)} />
        </span>
        <input
          id={`bookops-${name}`}
          value={typed[name] ?? b[name] ?? ""}
          onChange={(e) => type(name, e.target.value)}
          onBlur={() => void saveNow()}
          disabled={locked}
          autoComplete="off"
          lang="fi"
          className={`${input} ${!mine && source === "ai" ? "border-warn-line bg-warn-bg" : "border-line"}`}
        />
      </div>
    );
  };

  const query = book ? priceQuery({ isbn13: book.isbn13, title: typed.title ?? book.title, author: typed.author ?? book.author }) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <form onSubmit={(e) => void addIsbn(e)} aria-label="Add by ISBN" className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
          <div className="flex gap-2">
            <input
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              placeholder="ISBN — typed, or with a hand-held reader"
              aria-label="ISBN"
              inputMode="numeric"
              autoComplete="off"
              className={`${input} border-line`}
            />
            <button type="submit" disabled={!isbn.trim()} className="h-10 shrink-0 rounded-lg bg-accent px-4 text-sm font-medium text-accent-contrast disabled:opacity-40">
              Add
            </button>
          </div>
          {isbnNote && (
            <p role="alert" className="text-sm text-danger">
              {isbnNote}
            </p>
          )}
        </form>
        <p className="py-2 text-sm text-muted">
          {todo.length} to do · {listed.length} listed
          {STORE_IS_STAND_IN && " · test connection to the web store: nothing is really sent yet"}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)_20rem] lg:items-start">
        <div aria-label="Queue" className="flex flex-col gap-5">
          <section aria-label="To do" className="flex flex-col gap-2">
            <h2 className="px-1 text-sm font-semibold">To do ({todo.length})</h2>
            {todo.length || adding ? (
              <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                {adding > 0 && <li className="border-b border-line px-3 py-3 text-sm text-muted last:border-0">Adding the book…</li>}
                {todo.map(row)}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
                Nothing in the queue. Photograph a book&apos;s front and back cover with the camera, or on a phone in BookOps.
              </p>
            )}
          </section>
          {listed.length > 0 && (
            <section aria-label="Listed" className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold text-muted">✓ Listed ({listed.length})</h2>
              <ul className="overflow-hidden rounded-xl border border-line bg-surface opacity-70">{listed.map(row)}</ul>
            </section>
          )}
        </div>

        {book ? (
          <section aria-label="Book" className="flex min-w-0 flex-col gap-5 rounded-xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight">{(typed.title ?? book.title)?.trim() || (isWorking(book) ? "New book" : "Untitled book")}</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[queueState(book)]}`}>{QUEUE_LABEL[queueState(book)]}</span>
              </div>
              {book.isbn13 ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>
                    ISBN {formatIsbn(book.isbn13)}
                    {book.isbnSource && book.isbnSource !== "ai" && book.isbnSource !== "you" ? ` · ${sourceLabel(book.isbnSource)}` : ""}
                  </span>
                  {book.isbnSource === "ai" && <Tag kind="warn">AI read it · check</Tag>}
                  {book.lookupStatus === "not_found" && <span>· not in the book databases</span>}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <label htmlFor="bookops-isbn">{book.aiStatus === "pending" ? "No barcode found — the AI is looking for the ISBN. Or type it:" : "No ISBN. If the book has one, type it:"}</label>
                  <input
                    id="bookops-isbn"
                    value={typed.isbn ?? ""}
                    onChange={(e) => type("isbn", e.target.value)}
                    onBlur={() => void saveNow()}
                    disabled={locked}
                    inputMode="numeric"
                    autoComplete="off"
                    className={`${input} h-9 w-44 border-line`}
                  />
                </div>
              )}
            </div>

            {locked && (
              <div role="status" aria-label="In the web store" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-emerald-600/30 bg-emerald-500/10 p-3 text-sm">
                <p className="min-w-0 flex-1">
                  <strong>✓ In the web store</strong>
                  {book.listedAt && ` since ${when(book.listedAt)}`}
                  {book.listingRef && ` · reference ${book.listingRef}`}
                  {STORE_IS_STAND_IN && <span className="block text-muted">Test connection: nothing is really sent yet.</span>}
                </p>
                <button type="button" disabled={busy !== null} onClick={() => void takeBack(book)} className="h-10 rounded-lg border border-line bg-surface px-4 font-medium disabled:opacity-40">
                  {busy === "back" ? "Taking it back…" : "Take back to change it"}
                </button>
              </div>
            )}

            <div className="flex flex-col gap-4 rounded-xl border border-line bg-background p-4">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bookops-price" className="text-sm font-medium">
                    Price €
                  </label>
                  <input
                    id="bookops-price"
                    value={typed.price ?? (book.priceCents !== null ? formatPrice(book.priceCents) : "")}
                    onChange={(e) => type("price", e.target.value)}
                    onBlur={() => void saveNow()}
                    disabled={locked}
                    placeholder="0,00"
                    inputMode="decimal"
                    autoComplete="off"
                    className="h-13 w-36 rounded-lg border-2 border-accent bg-surface px-3 text-2xl outline-none focus:ring-4 focus:ring-accent/20 disabled:opacity-70"
                  />
                </div>
                <div className="flex min-w-56 flex-col gap-1.5">
                  <span className="text-sm font-medium">Condition</span>
                  <ConditionChips value={book.condition} label="Condition" disabled={locked} onPick={(c) => void setCondition(book, c)} />
                </div>
              </div>
              <nav aria-label="Price check" className="flex flex-col gap-2">
                <p className="text-sm text-muted">
                  {query
                    ? `Check prices: each opens in a new tab, searching for ${book.isbn13 ? "the ISBN" : `“${query}”`}.`
                    : "Check prices: needs an ISBN or a title first."}
                </p>
                <ul className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                  {PRICE_SITES.map((site, i) => (
                    <li key={site.id} className="min-w-0">
                      <a
                        href={query ? site.url(query) : undefined}
                        target="_blank"
                        rel="noreferrer"
                        aria-disabled={query ? undefined : "true"}
                        className={`flex h-full min-h-12 flex-col justify-center rounded-lg border bg-surface px-3 py-2 ${i === 0 ? "border-accent" : "border-line"} ${query ? "hover:border-accent" : "pointer-events-none opacity-50"}`}
                      >
                        <span className="flex items-center justify-between gap-1 text-sm font-semibold">
                          {site.name} <span aria-hidden>↗</span>
                        </span>
                        <span className="text-xs text-muted">{site.about}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {field(book, "title", "Title")}
              {field(book, "author", "Author")}
              {field(book, "publisher", "Publisher")}
              <div className="grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1.4fr)] gap-3">
                {field(book, "year", "Year")}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor="bookops-quantity" className="text-sm font-medium">
                    Copies
                  </label>
                  <input
                    id="bookops-quantity"
                    value={typed.quantity ?? String(book.quantity)}
                    onChange={(e) => type("quantity", e.target.value)}
                    onBlur={() => void saveNow()}
                    disabled={locked}
                    inputMode="numeric"
                    autoComplete="off"
                    className={`${input} border-line`}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor="bookops-location" className="text-sm font-medium">
                    Location
                  </label>
                  <input
                    id="bookops-location"
                    value={typed.location ?? book.location ?? ""}
                    onChange={(e) => type("location", e.target.value)}
                    onBlur={() => void saveNow()}
                    disabled={locked}
                    placeholder="Shelf A3, storage…"
                    autoComplete="off"
                    className={`${input} border-line`}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <label htmlFor="bookops-description">Description</label>
                {"description" in typed || book.descriptionSource === "you" ? (
                  <Tag kind="plain">Yours</Tag>
                ) : book.descriptionSource === "ai" ? (
                  <Tag kind="info">AI read the back cover</Tag>
                ) : book.aiStatus === "pending" ? (
                  <Tag kind="info">AI is reading the back cover…</Tag>
                ) : null}
              </span>
              <textarea
                id="bookops-description"
                value={typed.description ?? book.description ?? ""}
                onChange={(e) => type("description", e.target.value)}
                onBlur={() => void saveNow()}
                disabled={locked}
                rows={9}
                lang="fi"
                spellCheck
                placeholder={
                  book.aiStatus === "pending"
                    ? "The text appears here in a few seconds. Carry on with the other fields meanwhile — or type here any time."
                    : "The back-cover text."
                }
                className={`min-h-40 w-full resize-y rounded-lg border bg-surface p-3 text-sm leading-relaxed outline-none focus:border-accent disabled:opacity-70 ${
                  book.aiStatus === "pending" && !("description" in typed) && !book.description ? "animate-pulse border-dashed border-accent/60" : "border-line"
                }`}
              />
              {book.aiStatus === "failed" && !locked && (
                <p role="status" aria-label="AI reading" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn-line bg-warn-bg p-2.5 text-sm text-warn-text">
                  <span>The AI couldn&apos;t read the photos{book.aiNote ? ` (${book.aiNote.replace(/\.$/, "")})` : ""}. Type the text, or</span>
                  <button type="button" onClick={() => nudge(book.id, true)} className="font-semibold underline">
                    try again
                  </button>
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!locked && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void send(book)}
                  className="h-12 rounded-xl bg-accent px-5 font-medium text-accent-contrast disabled:opacity-40"
                >
                  {busy === "send" ? "Sending to the web store…" : "Send to web store"}
                </button>
              )}
              {!locked && (
                <button type="button" onClick={() => void remove(book)} className="h-12 rounded-xl border border-danger/40 px-5 font-medium text-danger">
                  Delete
                </button>
              )}
              <p role="status" aria-label="Saving" className={`min-w-0 flex-1 text-sm ${save.status === "error" ? "text-danger" : "text-muted"}`}>
                {save.status === "saving"
                  ? "Saving…"
                  : save.status === "saved"
                    ? "✓ Saved"
                    : save.status === "error"
                      ? (save.error ?? "Couldn't save.")
                      : locked
                        ? ""
                        : "Saves by itself."}
              </p>
            </div>
          </section>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
            {books.length ? "Choose a book from the queue." : "Photograph a book to start: front cover, then back cover."}
          </p>
        )}

        <aside className="flex flex-col gap-5">
          <BookOpsCamera onBook={(shots) => void onBook(shots)} notice={notice} />
          {book && (book.frontPhoto || book.backPhoto) && (
            <section aria-label="Photos of this book" className="flex flex-col gap-2 border-t border-line pt-4">
              <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Photos of this book</h2>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["Front cover · the listing's picture", book.frontPhoto],
                    ["Back cover · text and ISBN", book.backPhoto],
                  ] as const
                ).map(([caption, src]) =>
                  src ? (
                    <a key={caption} href={src} target="_blank" rel="noreferrer" className="flex flex-col gap-1.5 text-xs text-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="aspect-[4/3] w-full rounded-md bg-line/70 object-contain" />
                      {caption}
                    </a>
                  ) : null,
                )}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
