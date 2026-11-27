import fs from "node:fs/promises";
import path from "node:path";

const ANILIST_API = "https://graphql.anilist.co";
const KITSU_API = "https://kitsu.io/api/edge";
const OUT = process.env.OUT_DIR || ".";
const PAGE_SIZE = 50;
const KITSU_DELAY = 650;
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
    v === undefined || v === "" || (Array.isArray(v) && !v.length) ? undefined : v
  ));
}
function dateIso(value) {
  if (!value) return undefined;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function kitsuTitle(a) {
  return a.canonicalTitle || a.titles?.en || a.titles?.en_jp || a.titles?.ja_jp || "Unknown Anime";
}
function imageUrl(image) {
  return image?.original || image?.large || image?.medium || image?.small || undefined;
}
function catalogItem(m, kitsuId) {
  return {
    id: "kitsu:" + kitsuId,
    type: "series",
    name: m.title.english || m.title.romaji || m.title.native || ("AniList " + m.id),
    poster: m.coverImage.extraLarge || m.coverImage.large || "",
    posterShape: "poster",
    background: m.bannerImage || undefined,
    description: clean(m.description || ""),
    releaseInfo: m.seasonYear ? String(m.seasonYear) : "",
    genres: m.genres || [],
    runtime: m.duration ? String(m.duration) + " min" : undefined,
    imdbRating: m.averageScore ? (m.averageScore / 10).toFixed(1) : undefined
  };
}

async function findKitsuAnime(anilistId) {
  const params = new URLSearchParams({
    "filter[externalSite]": "anilist/anime",
    "filter[externalId]": String(anilistId)
  });
  const json = await kitsuFetch(KITSU_API + "/mappings?" + params.toString());
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

