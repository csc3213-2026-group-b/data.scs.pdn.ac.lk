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
not silently format or rewrite a contributor's branch. A serialized recovery
workflow opens one `automation/public-projections` pull request if an
authoritative change reaches `main` without matching projections. Deployment
runs against the exact successful `Validate Public Data` commit. The scheduled
deployment remains temporarily as a recovery path until the event-driven path
has been observed in production.

## Development

```sh
bun install
bun run check
```

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

The `main` ruleset must require `Validate Public Data`, including merge-queue
checks when the queue is enabled. GitHub Actions must be allowed to create pull
requests, and auto-merge must be enabled so the recovery projection pull
request can enter the same protected validation path. The workflow token uses
only `contents: write` and `pull-requests: write`; validation and deployment
remain read-only except for Cloudflare deployment credentials.
