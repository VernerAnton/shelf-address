import { describe, expect, it } from "vitest";
import { parseAiReading } from "@/lib/bookops-ai";

describe("the AI's answer for a BookOps book", () => {
  it("plain JSON", () => {
    const raw = JSON.stringify({ title: "Pääkallokehrääjä", author: "Ilkka Remes", isbn: "978-951-0-23076-3", description: "Ensimmäinen kappale\njatkuu tässä.\n\nToinen kappale." });
    expect(parseAiReading(raw)).toEqual({
      isbn13: "9789510230763",
      title: "Pääkallokehrääjä",
      author: "Ilkka Remes",
      description: "Ensimmäinen kappale\njatkuu tässä.\n\nToinen kappale.",
    });
  });
  it("inside a code fence, with words around it", () => {
    const raw = 'Here you go:\n```json\n{"title":"Sinuhe egyptiläinen","author":"Mika Waltari","isbn":null,"description":null}\n```';
    expect(parseAiReading(raw)).toEqual({ isbn13: null, title: "Sinuhe egyptiläinen", author: "Mika Waltari", description: null });
  });
  it("an old 10-digit ISBN becomes the 13-digit one", () => {
    expect(parseAiReading('{"isbn":"ISBN 951-0-23076-6"}').isbn13).toBe("9789510230763");
  });
  it("a misread ISBN fails its check digit and is dropped, not guessed", () => {
    expect(parseAiReading('{"isbn":"978-951-0-23076-4","title":"X"}')).toEqual({ isbn13: null, title: "X", author: null, description: null });
  });
  it("'null' written as a word, and empty strings, count as nothing", () => {
    expect(parseAiReading('{"title":"null","author":"  ","isbn":"","description":""}')).toEqual({ isbn13: null, title: null, author: null, description: null });
  });
  it("something that isn't JSON is refused", () => {
    expect(() => parseAiReading("I can't read this photo.")).toThrow(/couldn't be understood/);
    expect(() => parseAiReading("[1,2]")).toThrow();
  });
});
