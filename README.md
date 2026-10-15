# Patoune TV (personal fork of Sofa)

This is **sidounette79's personal, heavily customized fork** of
[jakejarvis/sofa](https://github.com/jakejarvis/sofa) — not the official
project, not affiliated with it beyond being derived from it, and not
accepting issues, PRs, or support requests here.

If you're looking for the real, actively maintained project, go to
**[jakejarvis/sofa](https://github.com/jakejarvis/sofa)** /
**[sofa.watch](https://sofa.watch)** instead. The badges, App Store/Play
Store links, Codecov, and Crowdin project in the upstream README all track
*that* project, not this fork, so they're removed here to avoid confusion.

## What's different here

- Rebranded "Patoune TV" throughout the UI
- Runs on **Postgres**, not SQLite (migrated 14.10)
- Real `pg_dump`/`pg_restore` backups instead of the upstream SQLite backup flow
- A bunch of household-specific fixes and features not upstream (see commit history)
- Built via this repo's own GitHub Actions → `ghcr.io/sidounette79/patoune-tv`, deployed to a home server - not meant to be installed by anyone else

For the original project's feature list, self-hosting instructions, and
screenshots, see [jakejarvis/sofa](https://github.com/jakejarvis/sofa).

## TMDB notice

This product uses the TMDB API but is not endorsed or certified by TMDB.

## License

[MIT](LICENSE)
