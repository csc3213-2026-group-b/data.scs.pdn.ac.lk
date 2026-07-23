# SCS PDN Public Data

This repository stores static JSON data published for SCS public sites. The
`public/` directory is the publishable root for Cloudflare CDN or public GitHub
JSON URLs.

## People Data

Public people-directory data lives under:

```text
public/
  people/
    v1/
      users/
        <username>.json
      staff/
        academic.json
        academic-support.json
        non-academic.json
      students/
        <batch>.json
      special/
        cs/
          <batch>.json
        ds/
          <batch>.json
        stat/
          <batch>.json
        sor/
          <batch>.json
```

Examples:

```text
public/people/v1/users/s21513.json
public/people/v1/users/ragel.json
public/people/v1/students/s21.json
public/people/v1/special/cs/s21.json
```

Staff profiles are stored in two places:

- `public/people/v1/users/<username>.json`
- one staff aggregate file under `public/people/v1/staff/`

Normal student profiles are stored in two places:

- `public/people/v1/users/<snumber>.json`
- `public/people/v1/students/<batch>.json`

Special student profiles are stored in three places because they are also normal
students:

- `public/people/v1/users/<snumber>.json`
- `public/people/v1/students/<batch>.json`
- `public/people/v1/special/<cs|ds|stat|sor>/<batch>.json`

The aggregate JSON files contain arrays. Empty aggregate files should contain:

```json
[]
```

The `users/`, `students/`, and `special/*/` directories include `.gitkeep`
placeholder files only so Git can track the empty directories before the first
generated profile JSON is added.

## Projects Data

Public projects-registry data lives under:

```text
public/
  projects/
    v1/
      manifest.json
      projects.json
      projects/
        <project-slug>.json
```

Examples:

```text
public/projects/v1/manifest.json
public/projects/v1/projects.json
public/projects/v1/projects/scholarship-management-system.json
```

Project records use
`@csc3213-2026-group-b/academic-domain-schemas` `ProjectSchema`. The aggregate
`projects.json` file contains every project, and each file under
`projects/<project-slug>.json` must exactly match the corresponding aggregate
record.

## Edit Flow

Users edit their public profile and project metadata from SCS public sites. The
API validates submitted JSON with
`@csc3213-2026-group-b/academic-domain-schemas`, then the SCS Portal GitHub App
creates or updates a pull request in this repository.

## Validation

Run the same checks locally with:

```bash
bun run check
```

The people-data validator uses
`@csc3213-2026-group-b/academic-domain-schemas` and accepts an empty initialized
data tree. Once profiles exist, it checks:

- every JSON file under `public/people/v1/` parses correctly
- staff and student profiles satisfy the domain schemas
- `public/people/v1/users/<username>.json` matches the profile identity
- staff, student, and special aggregate records match the corresponding user
  file exactly
- aggregate files do not contain duplicate profile identities
- required aggregate files exist when a user profile needs them

The projects-data validator checks:

- `public/projects/v1/manifest.json` exists and has a project list
- every project in `public/projects/v1/projects.json` satisfies `ProjectSchema`
- every project detail file is named after its project slug
- project detail files match the aggregate project record exactly
- every aggregate project has a corresponding project detail file

## GitHub Actions

`Validate Public Data` runs type checks, Bun tests, people-data validation,
projects-data validation, format checks, and the Worker build for pull requests
and `main` pushes that touch public data or validation code.

`Auto Merge Public Data PR` is restricted to same-repository `profile/*`
branches with both `profile-update` and `auto-merge-profile` labels, or
`project/*` branches with both `project-update` and `auto-merge-project` labels.
Project PR branches use `project/<slug>`. Before merging a project PR, the
workflow replays that project's detail JSON onto the latest `main`, regenerates
`projects.json` and `manifest.json`, pushes the reconciled branch when needed,
and waits for the next validation run. It merges only after the full check suite
passes on the reconciled branch.
