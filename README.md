# SCS PDN Public Data

This repository stores static JSON data published for SCS public sites. The
`public/` directory is the publishable root for Cloudflare CDN or public GitHub
JSON URLs.

## People Data

Public people-directory data lives under:

```text
public/
  people/
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
public/people/users/s21513.json
public/people/users/ragel.json
public/people/students/s21.json
public/people/special/cs/s21.json
```

Staff profiles are stored in two places:

- `public/people/users/<username>.json`
- one staff aggregate file under `public/people/staff/`

Normal student profiles are stored in two places:

- `public/people/users/<snumber>.json`
- `public/people/students/<batch>.json`

Special student profiles are stored in three places because they are also normal
students:

- `public/people/users/<snumber>.json`
- `public/people/students/<batch>.json`
- `public/people/special/<cs|ds|stat|sor>/<batch>.json`

The aggregate JSON files contain arrays. Empty aggregate files should contain:

```json
[]
```

The `users/`, `students/`, and `special/*/` directories include `.gitkeep`
placeholder files only so Git can track the empty directories before the first
generated profile JSON is added.

## Edit Flow

Users edit their public profile from the SCS Portal. The API validates submitted
JSON with `@csc3213-2026-group-b/academic-domain-schemas`, then the SCS Portal
GitHub App creates or updates a pull request in this repository.

## Validation

Run the same checks locally with:

```bash
bun run check
```

The people-data validator uses
`@csc3213-2026-group-b/academic-domain-schemas` and accepts an empty initialized
data tree. Once profiles exist, it checks:

- every JSON file under `public/people/` parses correctly
- staff and student profiles satisfy the domain schemas
- `public/people/users/<username>.json` matches the profile identity
- staff, student, and special aggregate records match the corresponding user
  file exactly
- aggregate files do not contain duplicate profile identities
- required aggregate files exist when a user profile needs them

## GitHub Actions

`Validate Public Data` runs type checks, Bun tests, people-data validation,
format checks, and the Worker build for pull requests and `main` pushes that
touch public data or validation code.

`Auto Merge Profile PR` is restricted to same-repository `profile/*` branches
with both `profile-update` and `auto-merge-profile` labels. It runs the full
check suite and merges the PR only after the checks pass.
