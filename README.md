# SCS PDN Public Data

Public JSON data for SCS PDN websites.

This repo is where approved public data is stored before it is served to the
people directory, project registry, and other public SCS sites.

## What It Contains

- People directory data.
- Project registry data.
- Academic course and offering data.
- Validation scripts for published JSON.
- Worker code for serving the static data.

## How Updates Happen

Most changes start in the portal. The API validates the submission, the GitHub
App opens a pull request here, and the data is published after validation and
merge.

## Development

```sh
bun install
bun run check
```

Focused validation commands:

```sh
bun run validate:people
bun run validate:projects
bun run validate:academic
```
