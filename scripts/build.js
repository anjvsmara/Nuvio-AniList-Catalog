import fs from "node:fs/promises";
import path from "node:path";

const ANILIST_API = "https://graphql.anilist.co";
const KITSU_API = "https://kitsu.io/api/edge";
const OUT = process.env.OUT_DIR || ".";
const PAGE_SIZE = 50;
const KITSU_DELAY = 400;
let lastKitsuRequest = 0;

const query = `
query ($page: Int, $perPage: Int, $sort: [MediaSort], $status: MediaStatus, $minScore: Int, $minPopularity: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, format: TV, sort: $sort, status: $status, averageScore_greater: $minScore, popularity_greater: $minPopularity, isAdult: false) {
      id
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
      averageScore
      seasonYear
      genres
      duration
    }
  }
}`;

async function anilist(variables) {
  const response = await fetch(ANILIST_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error("AniList HTTP " + response.status);
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors.map(x => x.message).join("; "));
  return json.data.Page.media;
}

async function kitsuFetch(url) {
  const wait = KITSU_DELAY - (Date.now() - lastKitsuRequest);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastKitsuRequest = Date.now();

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.api+json" }
    });
    if (response.ok) return response.json();

    const body = await response.text();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error("Kitsu HTTP " + response.status + " :: " + body.slice(0, 250));
    }
    const retryAfter = Number(response.headers.get("retry-after")) || (2 ** attempt);
    await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter * 1000, 15000)));
  }
  throw new Error("Kitsu request retries exhausted");
}

function omitEmpty(value) {
  return JSON.parse(JSON.stringify(value, (k, v) =>
    v === undefined || v === "" ? undefined : v
  ));
}

function catalogItem(m, kitsuId) {
  return omitEmpty({
    id: "kitsu:" + kitsuId,
    type: "series",
    name: m.title.english || m.title.romaji || m.title.native || ("AniList " + m.id),
    poster: m.coverImage.extraLarge || m.coverImage.large || undefined,
    posterShape: "poster",
    background: m.bannerImage || undefined,
    description: m.description || undefined,
    releaseInfo: m.seasonYear ? String(m.seasonYear) : undefined,
    genres: m.genres || [],
    runtime: m.duration ? String(m.duration) + " min" : undefined,
    imdbRating: m.averageScore ? (m.averageScore / 10).toFixed(1) : undefined
  });
}

async function findKitsuId(anilistId) {
  const params = new URLSearchParams({
    "filter[externalSite]": "anilist/anime",
    "filter[externalId]": String(anilistId),
    include: "item"
  });
  const json = await kitsuFetch(KITSU_API + "/mappings?" + params.toString());
  const mapping = json.data?.find(x => x.relationships?.item?.data?.type === "anime");
  return mapping?.relationships?.item?.data?.id || null;
}

async function writeJson(file, data) {
  const full = path.join(OUT, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(data, null, 2) + "\n");
}

const currentlyAiring = await anilist({
  page: 1, perPage: PAGE_SIZE, sort: ["POPULARITY_DESC"],
  status: "RELEASING", minScore: 65, minPopularity: 20000
});
const topRated = await anilist({
  page: 1, perPage: PAGE_SIZE, sort: ["SCORE_DESC"],
  minScore: 80, minPopularity: 20000
});

const uniqueAniList = new Map();
for (const m of [...currentlyAiring, ...topRated]) uniqueAniList.set(m.id, m);

const idByAniList = new Map();
for (const m of uniqueAniList.values()) {
  try {
    const kitsuId = await findKitsuId(m.id);
    if (kitsuId) idByAniList.set(m.id, kitsuId);
    else console.warn("No Kitsu mapping for AniList ID", m.id);
  } catch (error) {
    console.warn("Kitsu mapping failed for AniList ID", m.id, error.message);
  }
}

const airingMetas = currentlyAiring
  .filter(m => idByAniList.has(m.id))
  .map(m => catalogItem(m, idByAniList.get(m.id)));
const topRatedMetas = topRated
  .filter(m => idByAniList.has(m.id))
  .map(m => catalogItem(m, idByAniList.get(m.id)));

if (airingMetas.length + topRatedMetas.length === 0) {
  throw new Error("No AniList entries could be mapped to Kitsu. Refusing to publish empty catalogs.");
}

await writeJson("catalog/series/currently-airing.json", { metas: airingMetas });
await writeJson("catalog/series/top-rated.json", { metas: topRatedMetas });

console.log(
  "Built catalog-only AniList catalogs with Kitsu IDs:",
  airingMetas.length, "airing entries;",
  topRatedMetas.length, "top-rated entries;",
  idByAniList.size, "unique Kitsu mappings."
);
