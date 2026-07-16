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

const staffFiles = {
  academic: 'public/people/staff/academic.json',
  'academic-support': 'public/people/staff/academic-support.json',
  'non-academic': 'public/people/staff/non-academic.json'
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
  expected: Map<string, Map<string, JsonRecord>>
) {
  const userFiles = await listJsonFiles(root, 'public/people/users');

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
          `public/people/students/${batch}.json`,
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
        `${itemPath}: missing public/people/users/${key}.json`
      );
    } else if (!sameRecord(parsed, userRecord)) {
      result.errors.push(
        `${itemPath}: aggregate record differs from public/people/users/${key}.json`
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
  const studentFiles = await listJsonFiles(root, 'public/people/students');
  for (const file of studentFiles) {
    const batch = path.basename(file, '.json');
    if (!/^s\d{2}$/.test(batch)) {
      result.errors.push(`${file}: student aggregate file must be sYY.json`);
    }
    await validateAggregateFile(root, result, file, 'student', users, expected);
  }

  for (const aggregatePath of expected.keys()) {
    if (
      aggregatePath.startsWith('public/people/students/') &&
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
    const dir = `public/people/special/${stream}`;
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
            `${itemPath}: missing public/people/users/${key}.json`
          );
        } else if (!sameRecord(parsed, userRecord)) {
          result.errors.push(
            `${itemPath}: special record differs from public/people/users/${key}.json`
          );
        }
      }
    }
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

  for (const requiredPath of [
    'public/people/users',
    'public/people/staff',
    'public/people/students',
    ...specialStreams.map((stream) => `public/people/special/${stream}`)
  ]) {
    if (!existsSync(path.join(root, requiredPath))) {
      result.errors.push(`${requiredPath}: missing required directory`);
    }
  }

  await validateUserFiles(root, result, users, expected);

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
