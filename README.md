# Nuvio AniList Catalog

A static Nuvio addon catalog for Japanese TV anime, using AniList GraphQL.

## Catalogs

- **Currently Airing** — RELEASING TV anime, score above 65 and popularity above 20,000.
- **Top Rated** — TV anime, score above 80 and popularity above 20,000.

GitHub Actions refreshes generated JSON every six hours.

## Build locally

Requires Node.js 22+.

```sh
npm run build
```

Generated JSON is written into `catalog/` and `meta/` at the repository root.

## Install

Use the raw GitHub URL:

`https://raw.githubusercontent.com/anjvsmara/Nuvio-AniList-Catalog/main/manifest.json`

## Important limitation

This first version is a discovery and metadata catalog. Its IDs use the `anilist-` namespace; they are not TMDB IDs and do not automatically resolve to streams from TMDB-based providers. Playback compatibility needs a separate ID-mapping step.
