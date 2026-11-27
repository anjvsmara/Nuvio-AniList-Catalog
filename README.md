# Nuvio AniList × Kitsu Catalog

A static Nuvio addon for anime discovery. AniList selects the catalog entries; Kitsu supplies the canonical metadata and episode list.

## Catalogs

- **Currently Airing** — RELEASING TV anime, AniList score above 65 and popularity above 20,000.
- **Top Rated** — TV anime, AniList score above 80 and popularity above 20,000.

Each AniList entry is cross-referenced through Kitsu's `anilist/anime` mapping. Catalog and metadata IDs use the `kitsu:` namespace so they match Kitsu-based anime scrapers. Kitsu metadata responses include the available episode list.

GitHub Actions rebuilds the JSON every six hours and after pushes to `main`.

## Build locally

Requires Node.js 22+.

```sh
npm run build
```

Generated catalog JSON is written under `catalog/series/`; Kitsu metadata and episodes are written under `meta/series/`.

## Install

`https://raw.githubusercontent.com/anjvsmara/Nuvio-AniList-Catalog/main/manifest.json`

## Notes

- Titles without a Kitsu mapping are skipped because their IDs cannot be resolved by the Kitsu-based metadata/scraper flow.
- Episode availability depends on the records Kitsu exposes for each anime.
- This addon supplies catalog and metadata/episode information, not playable video streams.
