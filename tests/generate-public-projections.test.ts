import { afterEach, describe, expect, test } from 'bun:test';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatePublicProjections } from '../.github/scripts/generate-public-projections.js';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const tempRoots: string[] = [];

async function copyPublicTree() {
  const root = path.join(
    os.tmpdir(),
    `data-scs-projections-${crypto.randomUUID()}`
  );
  tempRoots.push(root);
  await cp(path.join(sourceRoot, 'public'), path.join(root, 'public'), {
    recursive: true
  });
  return root;
}

async function readJson(root: string, relativePath: string) {
  return JSON.parse(
    await readFile(path.join(root, relativePath), 'utf8')
  ) as unknown;
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('generatePublicProjections', () => {
  test('is idempotent after one deterministic generation', async () => {
    const root = await copyPublicTree();

    await generatePublicProjections({ root });
    const secondRun = await generatePublicProjections({ root, check: true });

    expect(secondRun).toEqual({ changed: [], removed: [] });
  });

  test('preserves CRLF in an existing generated file', async () => {
    const root = await copyPublicTree();
    await generatePublicProjections({ root });
    const searchPath = path.join(root, 'public/people/v2/search.json');
    const search = await readFile(searchPath, 'utf8');
    await writeFile(
      searchPath,
      search.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
    );

    const result = await generatePublicProjections({ root, check: true });

    expect(result).toEqual({ changed: [], removed: [] });
  });

  test('removes a deleted project from every derived membership', async () => {
    const root = await copyPublicTree();
    const slug = 'scs-pdn-portal';
    await generatePublicProjections({ root });
    await rm(path.join(root, `public/projects/v2/projects/${slug}.json`), {
      force: true
    });

    await generatePublicProjections({ root });

    const projects = (await readJson(
      root,
      'public/projects/v2/projects.json'
    )) as Array<{ slug: string }>;
    const manifest = (await readJson(
      root,
      'public/projects/v2/manifest.json'
    )) as { projects: Array<{ slug: string }> };
    const personProjects = (await readJson(
      root,
      'public/projects/v2/by-person/s21513.json'
    )) as Array<{ slug: string }>;

    expect(projects.some((project) => project.slug === slug)).toBeFalse();
    expect(
      manifest.projects.some((project) => project.slug === slug)
    ).toBeFalse();
    expect(personProjects.some((project) => project.slug === slug)).toBeFalse();
  });

  test('removes a deleted person from student and search projections', async () => {
    const root = await copyPublicTree();
    const identity = 's21513';
    await generatePublicProjections({ root });
    await rm(path.join(root, `public/people/v2/users/${identity}.json`), {
      force: true
    });

    await generatePublicProjections({ root });

    const students = (await readJson(
      root,
      'public/people/v2/students/s21.json'
    )) as Array<{ registrationNo: string }>;
    const search = (await readJson(
      root,
      'public/people/v2/search.json'
    )) as Array<{ identity: string }>;
    const special = (await readJson(
      root,
      'public/people/v2/special/computer-science/s21.json'
    )) as Array<{ registrationNo: string }>;

    expect(
      students.some(
        (student) => student.registrationNo.toLowerCase() === identity
      )
    ).toBeFalse();
    expect(search.some((entry) => entry.identity === identity)).toBeFalse();
    expect(
      special.some(
        (student) => student.registrationNo.toLowerCase() === identity
      )
    ).toBeFalse();
  });
});
