import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateAcademicData } from '../.github/scripts/validate-academic-data.js';

const course = {
  id: 'software-engineering-project',
  primaryCode: 'CSC3213',
  codes: ['CSC3213'],
  title: 'Software Engineering Project',
  credits: 3
};

const offering = {
  id: 'csc3213-2025-2026-sem2',
  courseId: course.id,
  academicYear: '2025/2026',
  semester: 'SEM2',
  staff: [
    {
      staff: 'ragel',
      role: 'COURSE_COORDINATOR'
    }
  ]
};

let tempRoots: string[] = [];

async function makeRoot() {
  const root = path.join(
    os.tmpdir(),
    `data-scs-academic-validation-${crypto.randomUUID()}`
  );
  tempRoots.push(root);
  await mkdir(path.join(root, 'public/academic/v1/courses'), {
    recursive: true
  });
  await mkdir(path.join(root, 'public/academic/v1/offerings'), {
    recursive: true
  });
  return root;
}

async function writeJson(root: string, relativePath: string, value: unknown) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
  tempRoots = [];
});

describe('validateAcademicData', () => {
  test('accepts consistent course and offering data', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/academic/v1/courses.json', [course]);
    await writeJson(root, 'public/academic/v1/offerings.json', [offering]);
    await writeJson(
      root,
      'public/academic/v1/courses/software-engineering-project.json',
      course
    );
    await writeJson(
      root,
      'public/academic/v1/offerings/csc3213-2025-2026-sem2.json',
      offering
    );

    const result = await validateAcademicData(root);

    expect(result.errors).toEqual([]);
    expect(result.counts.courses).toBe(1);
    expect(result.counts.offerings).toBe(1);
  });

  test('rejects an offering that references a missing course', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/academic/v1/courses.json', []);
    await writeJson(root, 'public/academic/v1/offerings.json', [offering]);
    await writeJson(
      root,
      'public/academic/v1/offerings/csc3213-2025-2026-sem2.json',
      offering
    );

    const result = await validateAcademicData(root);

    expect(result.errors).toContain(
      'public/academic/v1/offerings.json[0].courseId: missing referenced course'
    );
  });
});
