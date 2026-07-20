import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validatePeopleData } from '../.github/scripts/validate-people-data.js';

const student = {
  title: 'Mr',
  fullName: 'Jane Student',
  registrationNo: 'S21513',
  level: 'UNDERGRADUATE'
};

const academic = {
  title: 'Dr',
  fullName: 'Jane Academic',
  email: 'jane@pdn.ac.lk',
  staffType: 'ACADEMIC_TEACHING',
  academicRank: 'LECTURER'
};

const academicSupport = {
  title: 'Mr',
  fullName: 'Jane Academic',
  email: 'jane@pdn.ac.lk',
  staffType: 'ACADEMIC_SUPPORT',
  designation: 'PROGRAMMER'
};

let tempRoots: string[] = [];

async function makeRoot() {
  const root = path.join(
    os.tmpdir(),
    `data-scs-validation-${crypto.randomUUID()}`
  );
  tempRoots.push(root);

  for (const dir of [
    'public/people/v1/users',
    'public/people/v1/staff',
    'public/people/v1/students',
    'public/people/v1/special/cs',
    'public/people/v1/special/ds',
    'public/people/v1/special/stat',
    'public/people/v1/special/sor'
  ]) {
    await mkdir(path.join(root, dir), { recursive: true });
  }

  for (const file of [
    'public/people/v1/staff/academic.json',
    'public/people/v1/staff/academic-support.json',
    'public/people/v1/staff/non-academic.json'
  ]) {
    await writeJson(root, file, []);
  }

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

describe('validatePeopleData', () => {
  test('accepts an empty initialized data tree', async () => {
    const root = await makeRoot();

    const result = await validatePeopleData(root);

    expect(result.errors).toEqual([]);
    expect(result.counts.users).toBe(0);
  });

  test('accepts a consistent student user and aggregate record', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/people/v1/users/s21513.json', student);
    await writeJson(root, 'public/people/v1/students/s21.json', [student]);

    const result = await validatePeopleData(root);

    expect(result.errors).toEqual([]);
    expect(result.counts.users).toBe(1);
    expect(result.counts.students).toBe(1);
  });

  test('rejects aggregate records that do not match their user file', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/people/v1/users/s21513.json', student);
    await writeJson(root, 'public/people/v1/students/s21.json', [
      { ...student, fullName: 'Different Name' }
    ]);

    const result = await validatePeopleData(root);

    expect(result.errors).toContain(
      'public/people/v1/students/s21.json[0]: aggregate record differs from public/people/v1/users/s21513.json'
    );
  });

  test('rejects stale special aggregate records after a student becomes normal', async () => {
    const root = await makeRoot();
    const updatedStudent = { ...student, fullName: 'Jane Normal Student' };
    await writeJson(root, 'public/people/v1/users/s21513.json', updatedStudent);
    await writeJson(root, 'public/people/v1/students/s21.json', [
      updatedStudent
    ]);
    await writeJson(root, 'public/people/v1/special/cs/s21.json', [student]);

    const result = await validatePeopleData(root);

    expect(result.errors).toContain(
      'public/people/v1/special/cs/s21.json[0]: special record differs from public/people/v1/users/s21513.json'
    );
  });

  test('accepts cleaned special aggregate files after a student becomes normal', async () => {
    const root = await makeRoot();
    const updatedStudent = { ...student, fullName: 'Jane Normal Student' };
    await writeJson(root, 'public/people/v1/users/s21513.json', updatedStudent);
    await writeJson(root, 'public/people/v1/students/s21.json', [
      updatedStudent
    ]);
    await writeJson(root, 'public/people/v1/special/cs/s21.json', []);

    const result = await validatePeopleData(root);

    expect(result.errors).toEqual([]);
  });

  test('rejects stale staff aggregate records after a staff kind changes', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/people/v1/users/jane.json', academicSupport);
    await writeJson(root, 'public/people/v1/staff/academic-support.json', [
      academicSupport
    ]);
    await writeJson(root, 'public/people/v1/staff/academic.json', [academic]);

    const result = await validatePeopleData(root);

    expect(result.errors).toContain(
      'public/people/v1/staff/academic.json[0]: aggregate record differs from public/people/v1/users/jane.json'
    );
  });

  test('accepts cleaned staff aggregate files after a staff kind changes', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/people/v1/users/jane.json', academicSupport);
    await writeJson(root, 'public/people/v1/staff/academic-support.json', [
      academicSupport
    ]);
    await writeJson(root, 'public/people/v1/staff/academic.json', []);

    const result = await validatePeopleData(root);

    expect(result.errors).toEqual([]);
  });
});
