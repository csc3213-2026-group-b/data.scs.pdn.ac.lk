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

GitHub Actions should validate the changed JSON, auto-merge approved automation
PRs, and publish `public/` to the configured CDN.
