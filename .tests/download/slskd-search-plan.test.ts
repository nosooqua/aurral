import { test } from "vite-plus/test";
import assert from "node:assert/strict";

import {
  buildSlskdSearchTierGroups,
  hasSlskdSearchCandidates,
} from "../../backend/services/slskdOrchestrator.ts";

const fataTrack = {
  artistName: "From Autumn to Ashes",
  trackName: "The After Dinner Payback",
  albumName: "The Fiction We Live",
  releaseYear: "2003",
  artistAliases: [],
};

test("buildSlskdSearchTierGroups uses a short album-first search plan", () => {
  const tiers = buildSlskdSearchTierGroups(fataTrack);

  assert.equal(tiers[0]?.name, "base_album");
  assert.deepEqual(tiers[0].queries, ["From Autumn to Ashes The Fiction We Live"]);
  assert.ok(
    tiers.some(
      (tier) =>
        tier.name === "wildcard_album" &&
        tier.queries.includes("*rom *utumn to *shes The Fiction We Live"),
    ),
  );
  const wildcardAlbumIndex = tiers.findIndex((tier) => tier.name === "wildcard_album");
  const albumOnlyIndex = tiers.findIndex((tier) => tier.name === "album_only");
  assert.deepEqual(tiers[albumOnlyIndex]?.queries, ["The Fiction We Live"]);
  assert.ok(wildcardAlbumIndex < albumOnlyIndex);
  assert.ok(
    tiers.some(
      (tier) =>
        tier.name === "album_track" &&
        tier.queries.includes("The Fiction We Live The After Dinner Payback"),
    ),
  );
  assert.equal(albumOnlyIndex, tiers.length - 1);
});

test("hasSlskdSearchCandidates is false when no results are valid candidates", () => {
  const rawResults = Array.from({ length: 60 }, (_, index) => ({
    user: `user-${index}`,
    file: `music\\Artist\\Album\\Track ${index}.flac`,
  }));

  assert.equal(hasSlskdSearchCandidates(rawResults, fataTrack, { preferredFormat: "flac" }), false);
});

test("hasSlskdSearchCandidates waits for a small floor of valid candidates", () => {
  const validResults = Array.from({ length: 3 }, (_, index) => ({
    user: `valid-user-${index}`,
    file: `music\\From Autumn to Ashes\\The Fiction We Live\\01 The After Dinner Payback.flac`,
    slots: 1,
    speed: 700000,
  }));

  assert.equal(
    hasSlskdSearchCandidates(validResults.slice(0, 1), fataTrack, {
      preferredFormat: "flac",
    }),
    false,
  );
  assert.equal(
    hasSlskdSearchCandidates(validResults, fataTrack, {
      preferredFormat: "flac",
    }),
    true,
  );
  const silent = validResults.map((entry) => ({ ...entry, length: 240, size: 50000 }));
  assert.equal(hasSlskdSearchCandidates(silent, fataTrack, { preferredFormat: "flac" }), false);
});

test("Soulseek early exit ignores denied files and blacklisted peers", () => {
  const results = Array.from({ length: 3 }, (_, index) => ({
    user: `peer-${index}`,
    file: "music/From Autumn to Ashes/The Fiction We Live/01 The After Dinner Payback.flac",
    slots: 1,
    speed: 700000,
  }));
  const options = {
    deniedSourceKeys: new Set(results.map((entry) => `${entry.user}\0${entry.file}`.toLowerCase())),
  };
  assert.equal(hasSlskdSearchCandidates(results, fataTrack, options), false);
  assert.equal(
    hasSlskdSearchCandidates(results, fataTrack, {
      isUserBlacklisted: () => true,
    }),
    false,
  );
  const permitted = results.map((entry) => ({ ...entry, user: `allowed-${entry.user}` }));
  assert.equal(hasSlskdSearchCandidates([...results, ...permitted], fataTrack, options), true);
});

test("Soulseek early exit requires the requested remix and remixer", () => {
  const request = {
    artistName: "Abor & Tynna",
    albumName: "Bittersüß (Baller Deluxe)",
    trackName: "Baller - nowifi Remix",
    durationMs: 200000,
  };
  const resultsFor = (title: string) =>
    Array.from({ length: 3 }, (_, index) => ({
      user: `remix-peer-${index}`,
      file: `Music/Abor & Tynna/Bittersüß (Baller Deluxe)/25 - Abor & Tynna - ${title}.flac`,
      size: 30000000,
      length: 200,
    }));
  assert.equal(hasSlskdSearchCandidates(resultsFor("Baller"), request, {}), false);
  assert.equal(hasSlskdSearchCandidates(resultsFor("Baller (Another Remix)"), request, {}), false);
  assert.equal(hasSlskdSearchCandidates(resultsFor("Baller (nowifi Remix)"), request, {}), true);
});

test("Soulseek early exit ignores an artist contradiction even in the named album", () => {
  const results = Array.from({ length: 3 }, (_, index) => ({
    user: `other-artist-${index}`,
    file: "Music/Another Band/The Fiction We Live/01 Another Band - The After Dinner Payback.flac",
    size: 30000000,
    length: 200,
  }));
  assert.equal(hasSlskdSearchCandidates(results, fataTrack, {}), false);
});
