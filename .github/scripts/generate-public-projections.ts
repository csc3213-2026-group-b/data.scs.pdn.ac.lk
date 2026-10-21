import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { format } from 'prettier';

type JsonRecord = Record<string, unknown>;

interface GenerateOptions {
  root?: string;
  check?: boolean;
}

export interface ProjectionResult {
  changed: string[];
  removed: string[];
}

const PEOPLE_ROOT = 'public/people/v2';
const PROJECTS_ROOT = 'public/projects/v2';
const ACADEMIC_ROOT = 'public/academic/v2';

function toPosix(value: string) {
  return value.split(path.sep).join('/');
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(record: JsonRecord, field: string) {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function compareBy(field: string) {
  return (left: JsonRecord, right: JsonRecord) =>
    stringField(left, field).localeCompare(stringField(right, field));
}

function identityForPerson(record: JsonRecord) {
  const registrationNo = stringField(record, 'registrationNo');
  if (registrationNo) return registrationNo.toLowerCase();
  return stringField(record, 'email').split('@')[0]?.toLowerCase() ?? '';
}

function batchForStudent(record: JsonRecord) {
  return /^s\d{2}/i
    .exec(stringField(record, 'registrationNo'))?.[0]
    ?.toLowerCase();
}

function staffKind(record: JsonRecord) {
  switch (record.staffType) {
    case 'ACADEMIC_TEACHING':
      return 'academic';
    case 'ACADEMIC_SUPPORT':
      return 'academic-support';
    case 'NON_ACADEMIC':
      return 'non-academic';
    default:
      return null;
  }
}

function departmentSlug(record: JsonRecord) {
  const department = stringField(record, 'department');
  return department ? department.toLowerCase().replaceAll('_', '-') : null;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
    )
  ];
}

function searchEntry(record: JsonRecord) {
  const identity = identityForPerson(record);
  const kind = staffKind(record);
  const type = kind ? 'STAFF' : 'STUDENT';
  const title = stringField(record, 'title');
  const fullName = stringField(record, 'fullName');
  const email = stringField(record, 'email');
  const personalEmail = stringField(record, 'personalEmail');
  const name = [title, fullName].filter(Boolean).join(' ').trim();
  const subtitle =
    kind === 'academic'
      ? 'Academic Staff'
      : kind === 'academic-support'
        ? 'Academic Support Staff'
        : kind === 'non-academic'
          ? 'Non-Academic Staff'
          : record.status === 'ALUMNI'
            ? 'Alumni'
            : 'Student';

  return {
    id: `${type.toLowerCase()}:${identity}`,
    type,
    identity,
    href: `/people/${identity}`,
    name: name || fullName,
    subtitle,
    ...(email ? { email } : {}),
    keywords: uniqueStrings([
      identity,
      fullName,
      name,
      email,
      email.split('@')[0],
      personalEmail,
      stringField(record, 'registrationNo')
    ])
  };
}

async function readJson(root: string, relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function readJsonRecords(root: string, relativeDir: string) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const records: JsonRecord[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const value = await readJson(root, path.join(relativeDir, entry.name));
    if (!isRecord(value)) {
      throw new TypeError(
        `${toPosix(path.join(relativeDir, entry.name))}: expected object`
      );
    }
    records.push(value);
  }

  return records;
}

async function listJsonPaths(root: string, relativeDir: string) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  return (await readdir(absoluteDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => toPosix(path.join(relativeDir, entry.name)))
    .sort();
}

function addToGroup(
  groups: Map<string, JsonRecord[]>,
  relativePath: string,
  record: JsonRecord
) {
  const records = groups.get(relativePath) ?? [];
  records.push(record);
  groups.set(relativePath, records);
}

async function planPeople(root: string) {
  const users = await readJsonRecords(root, `${PEOPLE_ROOT}/users`);
  const usersByIdentity = new Map(
    users.map((record) => [identityForPerson(record), record])
  );
  const outputs = new Map<string, unknown>();
  const grouped = new Map<string, JsonRecord[]>();

  for (const record of users) {
    const kind = staffKind(record);
    if (kind) {
      addToGroup(grouped, `${PEOPLE_ROOT}/staff/${kind}.json`, record);
      const department = departmentSlug(record);
      if (department) {
        addToGroup(
          grouped,
          `${PEOPLE_ROOT}/staff/${department}/${kind}.json`,
          record
        );
      }
      continue;
    }

    const batch = batchForStudent(record);
    if (batch)
      addToGroup(grouped, `${PEOPLE_ROOT}/students/${batch}.json`, record);
  }

  const existingStaff = await listJsonPaths(root, `${PEOPLE_ROOT}/staff`);
  for (const department of await readdir(
    path.join(root, `${PEOPLE_ROOT}/staff`),
    {
      withFileTypes: true
    }
  )) {
    if (!department.isDirectory()) continue;
    existingStaff.push(
      ...(await listJsonPaths(root, `${PEOPLE_ROOT}/staff/${department.name}`))
    );
  }
  const existingStudents = await listJsonPaths(root, `${PEOPLE_ROOT}/students`);

  for (const relativePath of new Set([
    ...existingStaff,
    ...existingStudents,
    ...grouped.keys()
  ])) {
    outputs.set(
      relativePath,
      [...(grouped.get(relativePath) ?? [])].sort((a, b) =>
        identityForPerson(a).localeCompare(identityForPerson(b))
      )
    );
  }

  const specialRoot = `${PEOPLE_ROOT}/special`;
  if (existsSync(path.join(root, specialRoot))) {
    for (const stream of await readdir(path.join(root, specialRoot), {
      withFileTypes: true
    })) {
      if (!stream.isDirectory()) continue;
      for (const relativePath of await listJsonPaths(
        root,
        `${specialRoot}/${stream.name}`
      )) {
        const current = await readJson(root, relativePath);
        if (!Array.isArray(current)) continue;
        const records = current
          .filter(isRecord)
          .map((record) => usersByIdentity.get(identityForPerson(record)))
          .filter((record): record is JsonRecord => Boolean(record))
          .sort((a, b) =>
            identityForPerson(a).localeCompare(identityForPerson(b))
          );
        outputs.set(relativePath, records);
      }
    }
  }

  outputs.set(
    `${PEOPLE_ROOT}/search.json`,
    users.map(searchEntry).sort(compareBy('id'))
  );

  const manifestPath = `${PEOPLE_ROOT}/manifest.json`;
  const manifest = await readJson(root, manifestPath);
  if (isRecord(manifest)) {
    const batches = [...grouped.keys()]
      .filter((value) => value.startsWith(`${PEOPLE_ROOT}/students/`))
      .map((value) => path.basename(value, '.json'))
      .sort()
      .map((id) => ({
        id,
        displayName: id.toUpperCase(),
        defaultCategory: 'CURRENT',
        intakeYear: 2000 + Number(id.slice(1))
      }));
    const programmes = Array.isArray(manifest.programmes)
      ? manifest.programmes.filter(isRecord).map((programme) => {
          const directory = stringField(programme, 'directory');
          const prefix = `${specialRoot}/${directory}/`;
          const programmeBatches = [...outputs.entries()]
            .filter(
              ([relativePath, records]) =>
                relativePath.startsWith(prefix) &&
                Array.isArray(records) &&
                records.length > 0
            )
            .map(([relativePath]) => path.basename(relativePath, '.json'))
            .sort();
          return { ...programme, batches: programmeBatches };
        })
      : [];
    outputs.set(manifestPath, { ...manifest, batches, programmes });
  }

  return outputs;
}

function projectPersonEntry(project: JsonRecord, person: JsonRecord) {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    shortDescription: project.shortDescription,
    projectType: project.projectType,
    status: project.status,
    categories: project.categories,
    tags: project.tags,
    academicYear: project.academicYear,
    role: person.role,
    href: `projects/${String(project.slug)}.json`,
    lastUpdatedAt: isRecord(project.dates)
      ? project.dates.lastUpdatedAt
      : undefined
  };
}

async function planProjects(root: string) {
  const projects = (
    await readJsonRecords(root, `${PROJECTS_ROOT}/projects`)
  ).sort(compareBy('slug'));
  const outputs = new Map<string, unknown>();
  outputs.set(`${PROJECTS_ROOT}/projects.json`, projects);
  outputs.set(`${PROJECTS_ROOT}/manifest.json`, {
    version: 'v2',
    projects: projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      title: project.title,
      href: `projects/${String(project.slug)}.json`
    }))
  });

  const byPerson = new Map<string, JsonRecord[]>();
  for (const project of projects) {
    const people = Array.isArray(project.people)
      ? project.people.filter(isRecord)
      : [];
    for (const person of people) {
      const username = stringField(person, 'username').toLowerCase();
      if (!username) continue;
      addToGroup(
        byPerson,
        `${PROJECTS_ROOT}/by-person/${username}.json`,
        projectPersonEntry(project, person)
      );
    }
  }
  for (const [relativePath, records] of byPerson) {
    outputs.set(
      relativePath,
      records.sort(
        (left, right) =>
          stringField(left, 'title').localeCompare(
            stringField(right, 'title')
          ) ||
          stringField(left, 'slug').localeCompare(stringField(right, 'slug'))
      )
    );
  }

  return {
    outputs,
    managedPaths: await listJsonPaths(root, `${PROJECTS_ROOT}/by-person`)
  };
}

async function planAcademic(root: string) {
  const outputs = new Map<string, unknown>();
  outputs.set(
    `${ACADEMIC_ROOT}/courses.json`,
    (await readJsonRecords(root, `${ACADEMIC_ROOT}/courses`)).sort(
      compareBy('id')
    )
  );
  outputs.set(
    `${ACADEMIC_ROOT}/offerings.json`,
    (await readJsonRecords(root, `${ACADEMIC_ROOT}/offerings`)).sort(
      compareBy('id')
    )
  );
  return outputs;
}

async function applyPlan(
  root: string,
  outputs: Map<string, unknown>,
  removablePaths: string[],
  check: boolean
): Promise<ProjectionResult> {
  const changed: string[] = [];
  const removed = removablePaths.filter(
    (relativePath) => !outputs.has(relativePath)
  );

  for (const [relativePath, value] of outputs) {
    const absolutePath = path.join(root, relativePath);
    const next = await format(JSON.stringify(value), {
      parser: 'json',
      printWidth: 80,
      singleQuote: true,
      trailingComma: 'none'
    });
    const current = existsSync(absolutePath)
      ? await readFile(absolutePath, 'utf8')
      : null;
    if (current === next) continue;
    changed.push(relativePath);
    if (check) continue;
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, next);
  }

  if (!check) {
    await Promise.all(
      removed.map((relativePath) =>
        rm(path.join(root, relativePath), { force: true })
      )
    );
  }

  return { changed: changed.sort(), removed: removed.sort() };
}

export async function generatePublicProjections(
  options: GenerateOptions = {}
): Promise<ProjectionResult> {
  const root = options.root ?? process.cwd();
  const people = await planPeople(root);
  const projects = await planProjects(root);
  const academic = await planAcademic(root);
  const outputs = new Map([
    ...people.entries(),
    ...projects.outputs.entries(),
    ...academic.entries()
  ]);
  return applyPlan(
    root,
    outputs,
    projects.managedPaths,
    options.check ?? false
  );
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  const result = await generatePublicProjections({ check });
  const differences = [...result.changed, ...result.removed];

  if (check && differences.length > 0) {
    console.error('Public projections are stale:');
    for (const relativePath of differences) console.error(`- ${relativePath}`);
    process.exit(1);
  }

  if (differences.length === 0) {
    console.log('Public projections are current.');
  } else {
    console.log(
      `Updated ${result.changed.length} and removed ${result.removed.length} projections.`
    );
  }
}
