import { describe, expect, it } from "vitest";
import { getShoutAudioPath } from "./shoutVoice.ts";

describe("getShoutAudioPath", () => {
  it("maps known Russian shout phrases to local mp3 files", () => {
    expect(getShoutAudioPath("Чистейший!")).toBe("/shouts/Чистейший!.mp3");
    expect(getShoutAudioPath("Заюзаешь")).toBe("/shouts/Заюзаешь.mp3");
  });

  it("returns null for unknown phrases", () => {
    expect(getShoutAudioPath("Несуществующая фраза")).toBeNull();
  });
});
