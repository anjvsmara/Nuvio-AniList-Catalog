import fs from "node:fs/promises";
import path from "node:path";

const ANILIST_API = "https://graphql.anilist.co";
const KITSU_API = "https://kitsu.io/api/edge";
const OUT = process.env.OUT_DIR || ".";
const PAGE_SIZE = 50;

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
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.api+json" }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error("Kitsu HTTP " + response.status + " for " + url + " :: " + body.slice(0, 300));
  }
  return response.json();
}

function clean(value = "") {
  return String(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
function omitEmpty(value) {
  return JSON.parse(JSON.stringify(value, (k, v) =>
    v === undefined || v === "" ? undefined : v
  ));
}
function dateIso(value) {
  if (!value) return undefined;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function findKitsuAnime(anilistId) {
  // Keep the slash in externalSite literal; Kitsu's filter expects this exact value.
  const params = new URLSearchParams({
    "filter[externalSite]": "anilist/anime",
    "filter[externalId]": String(anilistId),
    include: "item"
  });
  const url = KITSU_API + "/mappings?" + params.toString();
  const json = await kitsuFetch(url);
  const mapping = json.data?.find(x => x.relationships?.item?.data?.type === "anime");
  if (!mapping) return null;
  const id = mapping.relationships.item.data.id;
  const animeJson = await kitsuFetch(KITSU_API + "/anime/" + encodeURIComponent(id) + "?include=genres");
  if (!animeJson.data) return null;
  const genres = (animeJson.included || [])
    .filter(x => x.type === "genres")
    .map(x => x.attributes?.name)
    .filter(Boolean);
  return { id, attributes: animeJson.data.attributes || {}, genres };
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

const uniqueAniList = new Map();
for (const m of [...currentlyAiring, ...topRated]) uniqueAniList.set(m.id, m);

const idByAniList = new Map();
for (const m of uniqueAniList.values()) {
  try {
    const kitsu = await findKitsuAnime(m.id);
    if (kitsu) {
      idByAniList.set(m.id, kitsu.id);

    } else {
      console.warn("No Kitsu mapping for AniList ID", m.id);
    }
  } catch (error) {
    console.warn("Kitsu mapping failed for AniList ID", m.id, error.message);
  }
}

if (idByAniList.size === 0) throw new Error("No AniList entries could be mapped to Kitsu. Refusing to publish empty catalogs.");

await writeJson("catalog/series/currently-airing.json", {
  metas: currentlyAiring
    .filter(m => idByAniList.has(m.id))
    .map(m => catalogItem(m, idByAniList.get(m.id)))
});
await writeJson("catalog/series/top-rated.json", {
  metas: topRated
    .filter(m => idByAniList.has(m.id))
    .map(m => catalogItem(m, idByAniList.get(m.id)))
});

console.log(
  "Built AniList catalogs with Kitsu IDs:",
  currentlyAiring.length, "airing candidates;",
  topRated.length, "top-rated candidates;",
  idByAniList.size, "Kitsu mappings."
);
