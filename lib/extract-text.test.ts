import { describe, expect, it } from "vitest";
import { textFileName, tidyAiText, tidyText, wordLikeness } from "./extract-text";

describe("tidyText", () => {
  it("joins lines broken by the page width into one paragraph", () => {
    expect(tidyText("Talvisota alkoi\nmarraskuussa 1939, ja\nkoko kansa lähti mukaan.")).toBe(
      "Talvisota alkoi marraskuussa 1939, ja koko kansa lähti mukaan.",
    );
  });

  it("keeps blank lines as paragraph breaks", () => {
    expect(tidyText("Ensimmäinen kappale\njatkuu.\n\nToinen kappale.\n\n\nKolmas.")).toBe(
      "Ensimmäinen kappale jatkuu.\n\nToinen kappale.\n\nKolmas.",
    );
  });

  it("rejoins words hyphenated across lines", () => {
    expect(tidyText("Palkittu kirjoit-\ntaja kertoo isoäi-\ndistään.")).toBe("Palkittu kirjoittaja kertoo isoäidistään.");
  });

  it("keeps real hyphens: after a capital or digit, or before a capital", () => {
    expect(tidyText("Myyty EU-\nmaissa ja 1990-\nluvulla, Etelä-\nSuomessa.")).toBe("Myyty EU-maissa ja 1990-luvulla, Etelä-Suomessa.");
  });

  it("keeps a dash with spaces around it as a dash", () => {
    expect(tidyText("Hän sanoi –\nja lähti.")).toBe("Hän sanoi – ja lähti.");
  });

  it("drops specks and collapses spaces", () => {
    expect(tidyText("|\nRomaani   sodasta.\n~\n.\nKansi: Otava")).toBe("Romaani sodasta. Kansi: Otava");
  });

  it("handles Windows line ends and empty input", () => {
    expect(tidyText("Rivi yksi\r\nrivi kaksi")).toBe("Rivi yksi rivi kaksi");
    expect(tidyText("  \n\n ")).toBe("");
  });
});

describe("textFileName", () => {
  it("names the file from the first words and the time", () => {
    expect(textFileName("Tuntematon sotilas on Väinö Linnan romaani", new Date(2026, 9, 26, 14, 5))).toBe(
      "tuntematon-sotilas-on-vaino-2026-10-26-1405.txt",
    );
  });
  it("falls back to 'teksti' when there are no words", () => {
    expect(textFileName("—", new Date(2026, 0, 2, 3, 4))).toBe("teksti-2026-01-02-0304.txt");
  });
});

describe("wordLikeness", () => {
  it("is high for real text", () => {
    expect(wordLikeness("Väinö Linnan romaani kertoo suomalaisesta konekiväärikomppaniasta jatkosodassa.")).toBeGreaterThan(0.9);
  });
  it("is low for text read the wrong way up", () => {
    expect(wordLikeness("= 3 5 5 <  5 = 2 8 2 Oo s 5 E = x 2» 3 =) PO E = & m < < [i = 3 S O! — E 5 m: j=] < 5 &")).toBeLessThan(0.2);
  });
  it("is 0 for nothing", () => {
    expect(wordLikeness("")).toBe(0);
  });
});

describe("tidyAiText", () => {
  it("keeps the model's paragraphs, trims stray space and code fences", () => {
    expect(tidyAiText("```\nEnsimmäinen kappale.  \n\n\n\nToinen kappale.\n```")).toBe("Ensimmäinen kappale.\n\nToinen kappale.");
  });
  it("leaves hyphens and letters exactly as given", () => {
    expect(tidyAiText("EU-maissa, Etelä-Suomessa – Åbo.")).toBe("EU-maissa, Etelä-Suomessa – Åbo.");
  });
});
