import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import type { IAudioMetadata } from "music-metadata";
import { coreTrackTitle } from "../../backend/services/trackMatching/titleText.ts";
import { checkVariantCompatibility } from "../../backend/services/trackMatching/semanticPolicy.ts";
import {
  decideRecording,
  verifyDownloadedRecording,
} from "../../backend/services/trackMatching/nativeMatcher.ts";
import { validateDownloadedTrackFile } from "../../backend/services/trackMatching/postDownloadValidator.ts";

const examples = [
  ["Abor & Tynna", "Baller - nowifi Remix", "Baller  (nowifi Remix)", "Bittersüß (Baller Deluxe)"],
  [
    "Without Letters",
    "Flicker - Teatre Remix",
    "Flicker (Teatre Remix)",
    "Abundance Supreme Remixes",
  ],
  ["Антоха МС", "Всё просто (RMX)", "Все просто (Remix)", "Всё просто (RMX)"],
  ["Artist", "It’s Fine — X RMX", "it's fine (X Remix)", "Album"],
] as const;

for (const [artist, expected, offered, album] of examples) {
  test(`same remix survives listing and original-tag validation: ${expected}`, async () => {
    const artistAliases = [artist, "Teatre", "nowifi"];
    const request = {
      title: expected,
      artists: [artist],
      artistAliases,
      durationMs: 200000,
      albumName: album,
    };
    const candidate = { title: offered, artists: [artist], durationMs: 200000, album };
    assert.equal(decideRecording(request, [candidate]).decision, "selectable");
    const verified = verifyDownloadedRecording(request, candidate);
    assert.equal(verified.decision, "matched", JSON.stringify(verified));
    assert.equal(verified.titleSimilarity, 1);
    const metadata: IAudioMetadata = {
      native: {},
      quality: { warnings: [] },
      common: {
        title: offered,
        artist,
        album,
        track: { no: 25, of: null },
        disk: { no: 1, of: null },
        movementIndex: { no: null, of: null },
        isrc: ["GBKQU2000509"],
      },
      format: {
        trackInfo: [],
        tagTypes: [],
        duration: 200,
        lossless: true,
        sampleRate: 44100,
        bitsPerSample: 16,
        bitrate: 900000,
      },
    };
    const result = await validateDownloadedTrackFile({
      request: {
        artistName: artist,
        artistAliases,
        trackName: expected,
        albumName: album,
        durationMs: 200000,
        isrc: "GBKQU2000509",
      },
      filePath: `/staging/25 - ${artist} - ${offered}.flac`,
      source: "soulseek",
      options: { parseFile: async () => metadata },
    });
    assert.equal(result.decision, "VERIFIED", JSON.stringify(result));
    assert.ok(result.native?.evidence.includes("isrc"));
  });
}

test("versions and remix authors remain non-overridable contradictions", () => {
  for (const [expected, offered, contradiction] of [
    ["Всё просто (RMX)", "Всё просто", "remix"],
    ["Baller - nowifi Remix", "Baller (Other Remix)", "remixer"],
    ["Baller - nowifi Remix", "Baller (Remix)", "remixer"],
    ["Song", "Song (Live)", "live"],
    ["Song", "Song (Acoustic)", "acoustic"],
    ["Song", "Song (Instrumental)", "instrumental"],
    ["Song", "Song (Radio Edit)", "radio_edit"],
    ["Song (Radio Edit)", "Song", "radio_edit"],
  ] as const) {
    const request = {
      title: expected,
      artists: ["Artist"],
      durationMs: 200000,
      isrc: "GBKQU2000509",
    };
    const candidate = { ...request, title: offered };
    assert.equal(decideRecording(request, [candidate]).decision, "skip", `${expected}/${offered}`);
    const result = verifyDownloadedRecording(request, candidate);
    assert.equal(result.decision, "no_match", `${expected}/${offered}`);
    assert.ok(result.contradictions.includes(contradiction), JSON.stringify(result));
  }
});

test("meaningful parentheses survive title broadening and same-length identity checks", () => {
  assert.equal(coreTrackTitle("Song (Where We Begin) - X Remix"), "Song (Where We Begin)");
  assert.equal(coreTrackTitle("Song (Part II)"), "Song (Part II)");
  assert.equal(coreTrackTitle("Song (Remix Culture)"), "Song (Remix Culture)");
  assert.equal(coreTrackTitle("Song (Live and Let Die)"), "Song (Live and Let Die)");
  assert.equal(coreTrackTitle("Live and Let Die"), "Live and Let Die");
  assert.equal(coreTrackTitle("Highway - Star City"), "Highway - Star City");
  assert.equal(
    verifyDownloadedRecording(
      { title: "(Music)", artists: ["Artist"], durationMs: 200000 },
      { title: "(Music)", artists: ["Artist"], durationMs: 200000 },
    ).decision,
    "matched",
  );
  for (const title of ["Song", "Another Song"]) {
    const result = verifyDownloadedRecording(
      {
        title: "Song (Where We Begin)",
        artists: ["Artist"],
        durationMs: 200000,
        isrc: "GBKQU2000509",
      },
      { title, artists: ["Artist"], durationMs: 200000, isrc: "GBKQU2000509" },
    );
    assert.equal(result.decision, "no_match");
    assert.ok(result.contradictions.includes("title"));
  }
});

test("release labels retain remix authors and reject the original", () => {
  const request = {
    artistName: "Without Letters",
    trackName: "Flicker - Teatre Remix",
    albumName: "Abundance Supreme Remixes",
  };
  assert.equal(
    checkVariantCompatibility(request, {
      title: "Without Letters - Flicker (Teatre Remix) (2020) FLAC",
    }).compatible,
    true,
  );
  assert.equal(
    checkVariantCompatibility(request, {
      title: "Without Letters - Flicker (Other Remix) (2020) FLAC",
    }).compatible,
    false,
  );
  assert.equal(
    checkVariantCompatibility(request, { title: "Without Letters - Flicker (2020) FLAC" })
      .compatible,
    false,
  );
});

test("explicit version labels keep year and mix suffix equivalents", () => {
  for (const [expected, offered] of [
    ["Song - Live", "Song (Live 2020)"],
    ["Song - Acoustic", "Song (Acoustic Mix)"],
    ["Song - Instrumental", "Song (Instrumental Mix)"],
  ]) {
    const request = { title: expected, artists: ["Artist"], durationMs: 200000 };
    const result = verifyDownloadedRecording(request, { ...request, title: offered });
    assert.equal(result.decision, "matched", JSON.stringify(result));
    assert.equal(result.titleSimilarity, 1);
  }
});

test("explicit original versions override remix album and filename hints", () => {
  const base = {
    artists: ["Without Letters"],
    albumName: "Abundance Supreme Remixes",
    durationMs: 200000,
    isrc: "GBKQU2000509",
  };
  for (const [expected, offered, filename] of [
    ["Flicker (Original Mix)", "Flicker (Teatre Remix)", "Flicker (Teatre Remix).flac"],
    ["Flicker - Original Version", "Flicker (Teatre Remix)", "Flicker (Teatre Remix).flac"],
    ["Flicker - Teatre Remix", "Flicker (Original Mix)", "Flicker (Teatre Remix).flac"],
    ["Flicker - Teatre Remix", "Flicker (Teatre Remix)", "Flicker (Original Mix).flac"],
  ] as const) {
    const request = { ...base, title: expected };
    const candidate = { ...base, title: offered, filename, album: base.albumName };
    const result = verifyDownloadedRecording(request, candidate);
    assert.equal(result.decision, "no_match", JSON.stringify(result));
    assert.ok(result.contradictions.includes("original-mix"));
    assert.equal(decideRecording(request, [candidate]).decision, "skip");
  }
  for (const [expected, offered] of [
    ["Flicker", "Flicker (Teatre Remix)"],
    ["Flicker (Original Mix)", "Flicker (Original Mix)"],
    ["Flicker (Original Mix)", "Flicker"],
  ]) {
    assert.equal(
      verifyDownloadedRecording({ ...base, title: expected }, { ...base, title: offered }).decision,
      "matched",
    );
  }
});

test("original downloaded tags cannot be overruled by remix filenames", async () => {
  for (const [expected, title, filename] of [
    ["Flicker (Original Mix)", "Flicker (Teatre Remix)", "Flicker (Teatre Remix)"],
    ["Flicker - Teatre Remix", "Flicker (Original Mix)", "Flicker (Teatre Remix)"],
  ] as const) {
    const metadata: IAudioMetadata = {
      native: {},
      quality: { warnings: [] },
      common: {
        title,
        artist: "Without Letters",
        album: "Abundance Supreme Remixes",
        track: { no: 1, of: null },
        disk: { no: 1, of: null },
        movementIndex: { no: null, of: null },
        isrc: ["GBKQU2000509"],
      },
      format: {
        trackInfo: [],
        tagTypes: [],
        duration: 200,
        lossless: true,
        sampleRate: 44100,
        bitsPerSample: 16,
        bitrate: 900000,
      },
    };
    const result = await validateDownloadedTrackFile({
      request: {
        artistName: "Without Letters",
        trackName: expected,
        albumName: "Abundance Supreme Remixes",
        durationMs: 200000,
        isrc: "GBKQU2000509",
      },
      filePath: `/staging/01 - Without Letters - ${filename}.flac`,
      source: "soulseek",
      options: { parseFile: async () => metadata },
    });
    assert.equal(result.decision, "CONFLICTED", JSON.stringify(result));
    assert.ok(result.contradictions?.includes("original-mix"));
  }
});

test("artist aliases cannot erase explicit remix author identity", () => {
  const request = {
    title: "Flicker - Teatre Remix",
    artists: ["Without Letters"],
    artistAliases: ["Without Letters", "Teatre"],
    albumName: "Abundance Supreme Remixes",
    durationMs: 385809,
  };
  for (const [title, expected] of [
    ["Flicker (Teatre Remix)", "matched"],
    ["Flicker - Teatre Remix", "matched"],
    ["Flicker (Other Remix)", "no_match"],
    ["Flicker (Remix)", "no_match"],
    ["Flicker", "no_match"],
  ] as const) {
    const candidate = { title, artists: ["Without Letters"], durationMs: 385809 };
    const result = verifyDownloadedRecording(request, candidate);
    assert.equal(result.decision, expected, JSON.stringify(result));
    assert.equal(
      decideRecording(request, [candidate]).decision,
      expected === "matched" ? "selectable" : "skip",
    );
    const semantic = checkVariantCompatibility(request, candidate);
    assert.deepEqual(semantic.expectedVariants.remixers, ["teatre"]);
    assert.ok(!semantic.candidateVariants.remixers.includes(""));
  }
});

test("underscore remix credits retain the author independently of artist aliases", () => {
  const request = {
    trackName: "Song - First DJ Remix",
    artistName: "Artist",
    artistAliases: ["First DJ"],
  };
  for (const [filename, accepted] of [
    ["01-artist-song_(first_dj_remix)-a2abde8b.mp3", true],
    ["01-artist-song_(other_dj_remix)-a2abde8b.mp3", false],
    ["01-artist-song_(remix)-a2abde8b.mp3", false],
    ["01-artist-song_(original_mix)-a2abde8b.mp3", false],
  ] as const) {
    const result = checkVariantCompatibility(request, { filename });
    assert.equal(result.compatible, accepted, JSON.stringify(result));
    if (accepted) assert.deepEqual(result.candidateVariants.remixers, ["first dj"]);
  }
});
