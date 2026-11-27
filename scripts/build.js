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
    v === undefined || v === "" ? undefined : v
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
  // Keep the slash in externalSite literal; Kitsu's filter expects this exact value.
  const url = KITSU_API + "/mappings?filter[externalSite]=anilist/anime" +
    "&filter[externalId]=" + encodeURIComponent(String(anilistId)) + "&include=item";
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

async function getKitsuEpisodes(kitsuId) {
  const episodes = [];
  let next = KITSU_API + "/anime/" + encodeURIComponent(kitsuId) +
    "/episodes?page%5Blimit%5D=20&page%5Boffset%5D=0&sort=number";
  let pages = 0;
  while (next && pages < 15) {
    const json = await kitsuFetch(next);
    episodes.push(...(json.data || []));
    next = json.links?.next || null;
    pages++;
  }
  return episodes;
}

function makeMeta(kitsuId, attributes, genres, episodeRows) {
  const id = "kitsu:" + kitsuId;
  const videos = episodeRows
    .map(row => {
      const a = row.attributes || {};
      const episode = Number(a.number);
      if (!Number.isFinite(episode) || episode < 0) return null;
      const season = a.seasonNumber != null && Number.isFinite(Number(a.seasonNumber))
        ? Number(a.seasonNumber) : 1;
      return omitEmpty({
        id: id + ":" + season + ":" + episode,
        title: a.canonicalTitle || a.titles?.en || a.titles?.en_jp || ("Episode " + episode),
        season,
        episode,
        released: dateIso(a.airdate),
        thumbnail: imageUrl(a.thumbnail),
        overview: clean(a.synopsis || ""),
        runtime: a.length ? String(a.length) : undefined
      });
    })
    .filter(Boolean)
    .sort((a, b) => a.season - b.season || a.episode - b.episode);

  const rating = Number(attributes.averageRating);
  const start = attributes.startDate;
  return omitEmpty({
    meta: {
      id,
      type: "series",
      name: kitsuTitle(attributes),
      poster: imageUrl(attributes.posterImage),
      background: imageUrl(attributes.coverImage),
      description: clean(attributes.synopsis || ""),
      releaseInfo: start ? String(start).slice(0, 4) : undefined,
      released: dateIso(start),
      runtime: attributes.episodeLength ? String(attributes.episodeLength) + " min" : undefined,
      genres,
      imdbRating: Number.isFinite(rating) ? (rating / 10).toFixed(1) : undefined,
      country: "Japan",
      status: attributes.status,
      videos
    }
  });
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

const resolved = new Map();
const idByAniList = new Map();
for (const m of uniqueAniList.values()) {
  try {
    const kitsu = await findKitsuAnime(m.id);
    if (kitsu) {
      idByAniList.set(m.id, kitsu.id);
      if (!resolved.has(kitsu.id)) resolved.set(kitsu.id, kitsu);
    } else {
      console.warn("No Kitsu mapping for AniList ID", m.id);
    }
  } catch (error) {
    console.warn("Kitsu mapping failed for AniList ID", m.id, error.message);
  }
}

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

for (const [kitsuId, anime] of resolved) {
  try {
    const episodes = await getKitsuEpisodes(kitsuId);
    await writeJson("meta/series/kitsu:" + kitsuId + ".json",
      makeMeta(kitsuId, anime.attributes, anime.genres, episodes));
  } catch (error) {
    console.warn("Kitsu metadata failed for Kitsu ID", kitsuId, error.message);
  }
}

console.log(
  "Built Kitsu-backed catalogs:",
  currentlyAiring.length, "airing candidates;",
  topRated.length, "top-rated candidates;",
  resolved.size, "Kitsu metadata records."
);
