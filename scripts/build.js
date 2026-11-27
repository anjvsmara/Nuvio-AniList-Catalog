import fs from "node:fs/promises";
import path from "node:path";

const API = "https://graphql.anilist.co";
const OUT = process.env.OUT_DIR || ".";
const PAGE_SIZE = 50;

const query = `
query ($page: Int, $perPage: Int, $sort: [MediaSort], $status: MediaStatus, $minScore: Int, $minPopularity: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, format: TV, sort: $sort, status: $status, averageScore_greater: $minScore, popularity_greater: $minPopularity, isAdult: false) {
      id
      idMal
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
      averageScore
      popularity
      episodes
      season
      seasonYear
      startDate { year month day }
      endDate { year month day }
      status
      genres
      duration
      studios(isMain: true) { nodes { name } }
    }
  }
}`;

async function anilist(variables) {
  const response = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error("AniList HTTP " + response.status);
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors.map(x => x.message).join("; "));
  return json.data.Page.media;
}

function clean(value = "") {
  return String(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
function dateText(m) {
  return m.startDate?.year ? String(m.startDate.year) : (m.seasonYear ? String(m.seasonYear) : "");
}
function catalogItem(m) {
  return {
    id: "anilist:" + m.id,
    type: "series",
    name: m.title.english || m.title.romaji || m.title.native || ("AniList " + m.id),
    poster: m.coverImage.extraLarge || m.coverImage.large || "",
    posterShape: "poster",
    background: m.bannerImage || undefined,
    description: clean(m.description || ""),
    releaseInfo: dateText(m),
    genres: m.genres || [],
    runtime: m.duration ? String(m.duration) + " min" : undefined,
    imdbRating: m.averageScore ? (m.averageScore / 10).toFixed(1) : undefined
  };
}
function metaItem(m) {
  const item = catalogItem(m);
  return {
    meta: {
      ...item,
      id: "anilist:" + m.id,
      status: m.status || undefined,
      released: m.startDate?.year && m.startDate?.month && m.startDate?.day
        ? new Date(Date.UTC(m.startDate.year, m.startDate.month - 1, m.startDate.day)).toISOString()
        : undefined,
      country: "Japan",
    }
  };
}
function omitEmpty(value) {
  return JSON.parse(JSON.stringify(value, (k,v) => v === undefined || v === "" ? undefined : v));
}
async function writeJson(file, data) {
  const full = path.join(OUT, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(omitEmpty(data), null, 2) + "\n");
}

const currentlyAiring = await anilist({
  page: 1, perPage: PAGE_SIZE, sort: ["POPULARITY_DESC"],
  status: "RELEASING", minScore: 65, minPopularity: 20000
});
const topRated = await anilist({
  page: 1, perPage: PAGE_SIZE, sort: ["SCORE_DESC"],
  minScore: 80, minPopularity: 20000
});

const all = new Map();
for (const m of [...currentlyAiring, ...topRated]) all.set(m.id, m);

// manifest.json is maintained at the repository root.
await writeJson("catalog/series/currently-airing.json", { metas: currentlyAiring.map(catalogItem) });
await writeJson("catalog/series/top-rated.json", { metas: topRated.map(catalogItem) });

for (const m of all.values()) {
  await writeJson("meta/series/" + "anilist:" + m.id + ".json", metaItem(m));
}

console.log("Built catalogs:", currentlyAiring.length, "airing;", topRated.length, "top-rated;", all.size, "metadata files.");
