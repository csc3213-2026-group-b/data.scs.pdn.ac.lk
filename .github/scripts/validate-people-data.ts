import {
  AcademicSupportStaffSchema,
  AcademicTeachingStaffSchema,
  NonAcademicStaffSchema,
  StudentSchema
} from '@csc3213-2026-group-b/academic-domain-schemas';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ZodType } from 'zod';
import { z } from 'zod';

type ProfileKind = 'academic' | 'academic-support' | 'non-academic' | 'student';
type JsonRecord = Record<string, unknown>;

interface ValidationResult {
  errors: string[];
  warnings: string[];
  counts: {
    users: number;
    academic: number;
    academicSupport: number;
    nonAcademic: number;
    students: number;
    special: number;
  };
}

const PeopleSearchEntrySchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(['STAFF', 'STUDENT']),
  identity: z.string().trim().toLowerCase().min(1),
  href: z
    .string()
    .trim()
    .regex(/^\/people\/[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(1),
  subtitle: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email().optional(),
  keywords: z.array(z.string().trim().toLowerCase().min(1)).min(1)
});

const PeopleSearchIndexSchema = z.array(PeopleSearchEntrySchema);
type PeopleSearchEntry = z.infer<typeof PeopleSearchEntrySchema>;

const staffFiles = {
  academic: 'public/people/v1/staff/academic.json',
  'academic-support': 'public/people/v1/staff/academic-support.json',
  'non-academic': 'public/people/v1/staff/non-academic.json'
} as const satisfies Record<Exclude<ProfileKind, 'student'>, string>;

const specialStreams = ['cs', 'ds', 'stat', 'sor'] as const;

const schemas = {
  academic: AcademicTeachingStaffSchema,
  'academic-support': AcademicSupportStaffSchema,
  'non-academic': NonAcademicStaffSchema,
  student: StudentSchema
} as const satisfies Record<ProfileKind, ZodType<JsonRecord>>;

function toPosix(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}

function recordKey(record: JsonRecord): string | null {
  const registrationNo = record.registrationNo;
  if (typeof registrationNo === 'string' && registrationNo.trim()) {
    return registrationNo.trim().toLowerCase();
  }

  const email = record.email;
  if (typeof email === 'string' && email.includes('@')) {
    return email.split('@')[0]?.trim().toLowerCase() || null;
  }

  return null;
}

function inferKind(record: JsonRecord): ProfileKind | null {
  if (record.staffType === 'ACADEMIC_TEACHING') return 'academic';
  if (record.staffType === 'ACADEMIC_SUPPORT') return 'academic-support';
  if (record.staffType === 'NON_ACADEMIC') return 'non-academic';
  if (typeof record.registrationNo === 'string') return 'student';
  return null;
}

function studentBatch(record: JsonRecord): string | null {
  const registrationNo = record.registrationNo;
  if (typeof registrationNo !== 'string') return null;
  const match = /^s\d{2}/i.exec(registrationNo.trim());
  return match?.[0].toLowerCase() ?? null;
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function sameRecord(a: JsonRecord, b: JsonRecord) {
  return stableJson(a) === stableJson(b);
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

function searchSubtitle(kind: ProfileKind, record: JsonRecord) {
  if (kind === 'academic') return 'Academic Staff';
  if (kind === 'academic-support') return 'Academic Support Staff';
  if (kind === 'non-academic') return 'Non-Academic Staff';
  if (record.status === 'ALUMNI') return 'Alumni';
  return 'Student';
}

function searchEntryForRecord(
  key: string,
  kind: ProfileKind,
  record: JsonRecord
): PeopleSearchEntry {
  const type = kind === 'student' ? 'STUDENT' : 'STAFF';
  const title = typeof record.title === 'string' ? record.title : '';
  const fullName = typeof record.fullName === 'string' ? record.fullName : '';
  const email = typeof record.email === 'string' ? record.email : undefined;
  const personalEmail =
    typeof record.personalEmail === 'string' ? record.personalEmail : undefined;
  const displayName = [title, fullName].filter(Boolean).join(' ').trim();

  return PeopleSearchEntrySchema.parse({
    id: `${type.toLowerCase()}:${key}`,
    type,
    identity: key,
    href: `/people/${key}`,
    name: displayName || fullName,
    subtitle: searchSubtitle(kind, record),
    ...(email ? { email } : {}),
    keywords: uniqueStrings([
      key,
      fullName,
      displayName,
      email,
      email?.split('@')[0],
      personalEmail,
      typeof record.registrationNo === 'string'
        ? record.registrationNo
        : undefined
    ])
  });
}

function sortSearchEntries(entries: PeopleSearchEntry[]) {
  return [...entries].sort((a, b) => a.id.localeCompare(b.id));
}

async function listJsonFiles(root: string, relativeDir: string) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];

  const entries = await readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => toPosix(path.join(relativeDir, entry.name)))
    .sort();
}

async function readJson(root: string, relativePath: string) {
  const absolutePath = path.join(root, relativePath);
  const content = await readFile(absolutePath, 'utf8');
  return JSON.parse(content) as unknown;
}

function validateRecord(
  result: ValidationResult,
  relativePath: string,
  schema: ZodType<JsonRecord>,
  record: unknown
): JsonRecord | null {
  const parsed = schema.safeParse(record);
  if (parsed.success) return parsed.data;

  for (const issue of parsed.error.issues) {
    const issuePath = issue.path.length ? `.${issue.path.join('.')}` : '';
    result.errors.push(`${relativePath}${issuePath}: ${issue.message}`);
  }
  return null;
}

function expectArray(
  result: ValidationResult,
  relativePath: string,
  value: unknown
): unknown[] | null {
  if (Array.isArray(value)) return value;
  result.errors.push(`${relativePath}: expected a JSON array`);
  return null;
}

function addExpectedAggregate(
  expected: Map<string, Map<string, JsonRecord>>,
  aggregatePath: string,
  key: string,
  record: JsonRecord
) {
  const records = expected.get(aggregatePath) ?? new Map<string, JsonRecord>();
  records.set(key, record);
  expected.set(aggregatePath, records);
}

async function validateUserFiles(
  root: string,
  result: ValidationResult,
  users: Map<string, JsonRecord>,
  expected: Map<string, Map<string, JsonRecord>>,
  expectedSearchEntries: Map<string, PeopleSearchEntry>
) {
  const userFiles = await listJsonFiles(root, 'public/people/v1/users');

  for (const userPath of userFiles) {
    const value = await readJson(root, userPath);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      result.errors.push(`${userPath}: expected a JSON object`);
      continue;
    }

    const record = value as JsonRecord;
    const key = recordKey(record);
    const filenameKey = path.basename(userPath, '.json').toLowerCase();
    if (!key) {
      result.errors.push(`${userPath}: unable to derive username from record`);
      continue;
    }

    if (key !== filenameKey) {
      result.errors.push(
        `${userPath}: filename key "${filenameKey}" does not match record key "${key}"`
      );
    }

    const kind = inferKind(record);
    if (!kind) {
      result.errors.push(`${userPath}: unable to infer profile kind`);
      continue;
    }

    const parsed = validateRecord(result, userPath, schemas[kind], record);
    if (!parsed) continue;

    users.set(key, parsed);
    result.counts.users += 1;
    expectedSearchEntries.set(key, searchEntryForRecord(key, kind, parsed));

    if (kind === 'academic') {
      result.counts.academic += 1;
      addExpectedAggregate(expected, staffFiles.academic, key, parsed);
    } else if (kind === 'academic-support') {
      result.counts.academicSupport += 1;
      addExpectedAggregate(
        expected,
        staffFiles['academic-support'],
        key,
        parsed
      );
    } else if (kind === 'non-academic') {
      result.counts.nonAcademic += 1;
      addExpectedAggregate(expected, staffFiles['non-academic'], key, parsed);
    } else {
      result.counts.students += 1;
      const batch = studentBatch(parsed);
      if (!batch) {
        result.errors.push(`${userPath}: unable to derive student batch`);
      } else {
        addExpectedAggregate(
          expected,
          `public/people/v1/students/${batch}.json`,
          key,
          parsed
        );
      }
    }
  }
}

async function validateAggregateFile(
  root: string,
  result: ValidationResult,
  relativePath: string,
  kind: ProfileKind,
  users: Map<string, JsonRecord>,
  expected: Map<string, Map<string, JsonRecord>>
) {
  if (!existsSync(path.join(root, relativePath))) {
    const expectedRecords = expected.get(relativePath);
    if (expectedRecords?.size) {
      result.errors.push(`${relativePath}: missing aggregate file`);
    }
    return;
  }

  const value = await readJson(root, relativePath);
  const records = expectArray(result, relativePath, value);
  if (!records) return;

  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const itemPath = `${relativePath}[${index}]`;
    const parsed = validateRecord(result, itemPath, schemas[kind], record);
    if (!parsed) continue;

    const key = recordKey(parsed);
    if (!key) {
      result.errors.push(`${itemPath}: unable to derive record key`);
      continue;
    }

    if (seen.has(key)) {
      result.errors.push(`${itemPath}: duplicate record key "${key}"`);
    }
    seen.add(key);

    const userRecord = users.get(key);
    if (!userRecord) {
      result.errors.push(
        `${itemPath}: missing public/people/v1/users/${key}.json`
      );
    } else if (!sameRecord(parsed, userRecord)) {
      result.errors.push(
        `${itemPath}: aggregate record differs from public/people/v1/users/${key}.json`
      );
    }
  }

  const expectedRecords = expected.get(relativePath);
  if (expectedRecords) {
    for (const key of expectedRecords.keys()) {
      if (!seen.has(key)) {
        result.errors.push(`${relativePath}: missing record "${key}"`);
      }
    }
  } else if (records.length > 0) {
    result.warnings.push(
      `${relativePath}: contains records not found in users`
    );
  }
}

async function validateStudentAggregates(
  root: string,
  result: ValidationResult,
  users: Map<string, JsonRecord>,
  expected: Map<string, Map<string, JsonRecord>>
) {
  const studentFiles = await listJsonFiles(root, 'public/people/v1/students');
  for (const file of studentFiles) {
    const batch = path.basename(file, '.json');
    if (!/^s\d{2}$/.test(batch)) {
      result.errors.push(`${file}: student aggregate file must be sYY.json`);
    }
    await validateAggregateFile(root, result, file, 'student', users, expected);
  }

  for (const aggregatePath of expected.keys()) {
    if (
      aggregatePath.startsWith('public/people/v1/students/') &&
      !studentFiles.includes(aggregatePath)
    ) {
      result.errors.push(`${aggregatePath}: missing aggregate file`);
    }
  }
}

async function validateSpecialAggregates(
  root: string,
  result: ValidationResult,
  users: Map<string, JsonRecord>
) {
  for (const stream of specialStreams) {
    const dir = `public/people/v1/special/${stream}`;
    const files = await listJsonFiles(root, dir);

    for (const file of files) {
      const batch = path.basename(file, '.json');
      if (!/^s\d{2}$/.test(batch)) {
        result.errors.push(`${file}: special aggregate file must be sYY.json`);
      }

      const value = await readJson(root, file);
      const records = expectArray(result, file, value);
      if (!records) continue;

      const seen = new Set<string>();
      for (const [index, record] of records.entries()) {
        const itemPath = `${file}[${index}]`;
        const parsed = validateRecord(result, itemPath, StudentSchema, record);
        if (!parsed) continue;

        const key = recordKey(parsed);
        if (!key) {
          result.errors.push(`${itemPath}: unable to derive record key`);
          continue;
        }

        if (seen.has(key)) {
          result.errors.push(`${itemPath}: duplicate record key "${key}"`);
        }
        seen.add(key);
        result.counts.special += 1;

        const userRecord = users.get(key);
        if (!userRecord) {
          result.errors.push(
            `${itemPath}: missing public/people/v1/users/${key}.json`
          );
        } else if (!sameRecord(parsed, userRecord)) {
          result.errors.push(
            `${itemPath}: special record differs from public/people/v1/users/${key}.json`
          );
        }
      }
    }
  }
}

async function validateSearchIndex(
  root: string,
  result: ValidationResult,
  expectedSearchEntries: Map<string, PeopleSearchEntry>
) {
  const searchPath = 'public/people/v1/search.json';
  const exists = existsSync(path.join(root, searchPath));

  if (!exists) {
    result.errors.push(`${searchPath}: missing search index file`);
    return;
  }

  const value = await readJson(root, searchPath);
  const parsed = PeopleSearchIndexSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const issuePath = issue.path.length ? `[${issue.path.join('.')}]` : '';
      result.errors.push(`${searchPath}${issuePath}: ${issue.message}`);
    }
    return;
  }

  const seen = new Set<string>();
  for (const [index, entry] of parsed.data.entries()) {
    const itemPath = `${searchPath}[${index}]`;
    if (seen.has(entry.identity)) {
      result.errors.push(
        `${itemPath}: duplicate search identity "${entry.identity}"`
      );
    }
    seen.add(entry.identity);

    const expected = expectedSearchEntries.get(entry.identity);
    if (!expected) {
      result.errors.push(
        `${itemPath}: missing public/people/v1/users/${entry.identity}.json`
      );
      continue;
    }

    if (!sameRecord(entry, expected)) {
      result.errors.push(
        `${itemPath}: search entry differs from public/people/v1/users/${entry.identity}.json`
      );
    }
  }

  for (const identity of expectedSearchEntries.keys()) {
    if (!seen.has(identity)) {
      result.errors.push(`${searchPath}: missing search entry "${identity}"`);
    }
  }

  const actualIds = parsed.data.map((entry) => entry.id);
  const sortedActualIds = [...actualIds].sort((a, b) => a.localeCompare(b));
  if (stableJson(actualIds) !== stableJson(sortedActualIds)) {
    result.errors.push(`${searchPath}: search entries must be sorted by id`);
  }
}

export async function validatePeopleData(
  root = process.cwd()
): Promise<ValidationResult> {
  const result: ValidationResult = {
    errors: [],
    warnings: [],
    counts: {
      users: 0,
      academic: 0,
      academicSupport: 0,
      nonAcademic: 0,
      students: 0,
      special: 0
    }
  };
  const users = new Map<string, JsonRecord>();
  const expected = new Map<string, Map<string, JsonRecord>>();
  const expectedSearchEntries = new Map<string, PeopleSearchEntry>();

  for (const requiredPath of [
    'public/people/v1/users',
    'public/people/v1/staff',
    'public/people/v1/students',
    ...specialStreams.map((stream) => `public/people/v1/special/${stream}`)
  ]) {
    if (!existsSync(path.join(root, requiredPath))) {
      result.errors.push(`${requiredPath}: missing required directory`);
    }
  }

  await validateUserFiles(root, result, users, expected, expectedSearchEntries);

  await validateAggregateFile(
    root,
    result,
    staffFiles.academic,
    'academic',
    users,
    expected
  );
  await validateAggregateFile(
    root,
    result,
    staffFiles['academic-support'],
    'academic-support',
    users,
    expected
  );
  await validateAggregateFile(
    root,
    result,
    staffFiles['non-academic'],
    'non-academic',
    users,
    expected
  );
  await validateStudentAggregates(root, result, users, expected);
  await validateSpecialAggregates(root, result, users);
  await validateSearchIndex(root, result, expectedSearchEntries);

  return result;
}

if (import.meta.main) {
  const result = await validatePeopleData();

  for (const warning of result.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (result.errors.length) {
    console.error('People data validation failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('People data validation passed.');
  console.log(
    [
      `users=${result.counts.users}`,
      `academic=${result.counts.academic}`,
      `academicSupport=${result.counts.academicSupport}`,
      `nonAcademic=${result.counts.nonAcademic}`,
      `students=${result.counts.students}`,
      `special=${result.counts.special}`
    ].join(' ')
  );
}
