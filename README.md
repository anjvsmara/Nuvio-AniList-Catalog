# Nuvio AniList Catalog

A catalog-only Nuvio addon for anime discovery. AniList selects and sorts anime; Kitsu mappings are used only to assign compatible `kitsu:` IDs.

## Catalogs

- **Currently Airing** — RELEASING TV anime, AniList score above 65 and popularity above 20,000.
- **Top Rated** — TV anime, AniList score above 80 and popularity above 20,000.

This addon exposes only the catalog resource. It does not provide metadata or episodes. Nuvio can use the metadata addons configured by the user to resolve the `kitsu:` IDs and show details/episodes, provided those addons support the same ID prefix.

GitHub Actions rebuilds the catalog JSON every six hours and after pushes to `main`.

## Build locally

Requires Node.js 22+.

```sh
npm run build
```

Generated catalog JSON is written under `catalog/series/`.

## Install

`https://raw.githubusercontent.com/anjvsmara/Nuvio-AniList-Catalog/main/manifest.json`

## Notes

- Anime without an AniList-to-Kitsu mapping are skipped.
- If no mappings are returned, the build fails rather than publishing an empty catalog.
- Playback still depends on a separate stream provider.
