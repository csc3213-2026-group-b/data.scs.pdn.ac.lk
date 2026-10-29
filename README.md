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

The entity files under `people/v2/users`, `projects/v2/projects`, and the
academic `courses` and `offerings` directories are authoritative. Collection,
search, manifest, staff, student, and `by-person` files are deterministic
projections. Special-programme files retain programme membership while the
generator refreshes each member from the authoritative user record.

Pull requests and merge-queue candidates only check generated output; CI does
not silently format or rewrite a contributor's branch. A separate privileged
workflow uses protected-base generator code to update only trusted, same-repo
PRs opened by the portal GitHub App. A serialized recovery workflow opens one
`automation/public-projections` pull request if an
authoritative change reaches `main` without matching projections. Deployment
runs against the exact successful `Validate Public Data` commit. Manual
dispatch remains the recovery path; the polling schedule was removed after the
event-driven production deployment succeeded.

## Development

```sh
bun install
bun run check
```

Validation imports `@csc3213-2026-group-b/scs-schemas`, the private package
published automatically from `packages/schemas` on the monorepo `main` branch.
For local installation, set `NODE_AUTH_TOKEN` to a GitHub token with
`read:packages` access. GitHub Actions uses its short-lived repository token;
the retired `@csc3213-2026-group-b/academic-domain-schemas` package is not used.

Regenerate projections after changing an authoritative entity:

```sh
bun run generate
bun run generate:check
```

Focused validation commands:

```sh
bun run validate:people
bun run validate:projects
bun run validate:academic
```

## Repository Settings

The `main` branch protection must require `Validate Public Data`, including
merge-queue checks when the queue is enabled. Auto-merge must be enabled.
Repository workflows use installation tokens from the existing portal GitHub
App for projection commits, recovery PRs, and auto-merge; the default workflow
token remains read-only apart from `packages: read` for the private schemas
package. Validation and deployment are read-only except for the Cloudflare
deployment credentials.

See [GitHub Actions automation](docs/GITHUB_ACTIONS_AUTOMATION.md) for the trust
model, required App secret and variable, repository settings, and recovery
procedure.
