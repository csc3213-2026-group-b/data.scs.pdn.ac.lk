# SCS PDN Public Data

Repository-backed JSON published for SCS public sites.

This repo is the source of truth for public people-directory data, project
registry data, and academic course/catalog data. Approved profile and project
changes are committed here through GitHub pull requests and then served as
static JSON by the data Worker.

## Published Data Areas

- `public/people/v1/**` - people-directory user files and aggregate lists.
- `public/projects/v1/**` - project registry manifest, aggregate list, and
  detail files.
- `public/academic/v1/**` - courses, course offerings, and detail files.

## People Data

Every public people profile has one lookup file:

```text
public/people/v1/users/<username>.json
```

Staff profiles are also stored in one staff aggregate:

```text
public/people/v1/staff/academic.json
public/people/v1/staff/academic-support.json
public/people/v1/staff/non-academic.json
```

Student profiles are also stored in the batch aggregate:

```text
public/people/v1/students/<batch>.json
```

Honours students are still student profiles. When `studentTrack` is `HONOURS`,
the same record is also stored in the matching honours-stream aggregate:

```text
public/people/v1/special/<cs|ds|stat|sor>/<batch>.json
```

Student records use `studentType` for undergraduate/postgraduate,
`studentTrack` for general/honours, `level` for `1000` through `4000`, and
`status` for current/alumni.

## Project Data

Project registry data lives under:

```text
public/projects/v1/manifest.json
public/projects/v1/projects.json
public/projects/v1/projects/<project-slug>.json
```

Project records must satisfy `ProjectSchema` from
`@csc3213-2026-group-b/academic-domain-schemas`. The aggregate
`projects.json` file and each detail file must match exactly.

Course projects must reference an existing academic offering through
`courseOffering.id`.

## Academic Data

Academic data lives under:

```text
public/academic/v1/courses.json
public/academic/v1/offerings.json
public/academic/v1/courses/<course-id>.json
public/academic/v1/offerings/<offering-id>.json
```

Courses are stable catalog entries. Offerings represent a course in a specific
academic year and semester.

## Local Validation

```sh
bun install
bun run check
```

`bun run check` runs type checks, tests, people-data validation,
academic-data validation, project-data validation, format checks, and the
Worker build.

Useful focused checks:

- `bun run validate:people`
- `bun run validate:academic`
- `bun run validate:projects`
- `bun run format:check`
