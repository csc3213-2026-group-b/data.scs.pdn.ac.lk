# SCS PDN Public Data

This repository stores the approved public JSON used by the SCS PDN websites.
People, projects, courses, and offerings are validated before publication.

## Development

Install the private `@csc3213-2026-group-b/scs-schemas` package with a GitHub
token that has `read:packages`, then run:

```sh
bun install
bun run check
```

The package version is pinned in `package.json` and `bun.lock`.

For the data layout, projection commands, validation, automation, and recovery,
see the [public data repository guide](https://docs.scs-pdn.space/docs/public-data-repository)
in the monorepo handbook.
