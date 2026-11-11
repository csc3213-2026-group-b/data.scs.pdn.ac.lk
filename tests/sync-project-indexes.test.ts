import { afterEach, describe, expect, test } from 'bun:test';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { generatePublicProjections } from '../.github/scripts/generate-public-projections.js';
import { syncProjectIndexes } from '../.github/scripts/sync-project-indexes.js';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('manual project index sync', () => {
  test('preserves registry identity and refreshes person projections', async () => {
    const root = path.join(
      os.tmpdir(),
      `project-index-sync-${crypto.randomUUID()}`
    );
    roots.push(root);
    await cp(path.join(sourceRoot, 'public'), path.join(root, 'public'), {
      recursive: true
    });
    const file = path.join(
      root,
      'public/projects/v2/projects/test-project.json'
    );
    const original = {
      id: 'prj-test-project',
      slug: 'test-project',
      title: 'Test project',
      shortDescription: 'A project index sync test fixture.',
      description: 'A standalone project used to test repository index sync.',
      projectType: 'DEPARTMENT_SYSTEM',
      status: 'ACTIVE',
      categories: ['department-system'],
      tags: ['test'],
      academicYear: '2025/2026',
      people: [
        {
          name: 'Previous Person',
          role: 'contributor',
          username: 'previousperson'
        }
      ],
      links: { repository: 'https://github.com/example/test-project' },
      media: {},
      dates: { startedAt: '2026-01-01', lastUpdatedAt: '2026-01-01' }
    };
    const source = {
      kind: 'TEMPLATE_INDEX_JSON',
      repositoryOwner: 'scs-pdn',
      repositoryName: 'portal',
      metadataPath: '.docs/index.json',
      indexUrl:
        'https://api.github.com/repos/scs-pdn/portal/contents/.docs/index.json'
    };
    await writeFile(
      file,
      `${JSON.stringify({ ...original, source }, null, 2)}\n`
    );
    const content = Buffer.from(
      JSON.stringify({
        $schema: 'https://api.scs-pdn.space/api/projects/v2/schemas/index.json',
        title: 'Updated portal',
        people: [
          { name: 'New Person', role: 'contributor', username: 'newperson' }
        ]
      })
    ).toString('base64');
    const fetcher = (async (url: string | URL | Request) =>
      String(url) === source.indexUrl
        ? Response.json({ content })
        : new Response(null, { status: 404 })) as typeof fetch;

    expect(await syncProjectIndexes({ root, fetcher })).toContain(
      'test-project.json'
    );
    await generatePublicProjections({ root });
    const updated = JSON.parse(await readFile(file, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(updated).toMatchObject({
      id: original.id,
      slug: original.slug,
      title: 'Updated portal'
    });
    const newPersonProjects = JSON.parse(
      await readFile(
        path.join(root, 'public/projects/v2/by-person/newperson.json'),
        'utf8'
      )
    ) as Array<{ slug: string }>;
    expect(newPersonProjects.map((project) => project.slug)).toContain(
      'test-project'
    );
    expect(
      await Bun.file(
        path.join(root, 'public/projects/v2/by-person/previousperson.json')
      ).exists()
    ).toBe(false);

    const courseContent = Buffer.from(
      JSON.stringify({
        projectType: 'COURSE_PROJECT',
        course: {
          courseId: 'software-engineering-project',
          code: 'CSC3213',
          title: 'Software Engineering Project'
        },
        media: { coverImage: 'https://example.com/cover.png' }
      })
    ).toString('base64');
    const courseFetcher = (async (url: string | URL | Request) =>
      String(url) === source.indexUrl
        ? Response.json({ content: courseContent })
        : new Response(null, { status: 404 })) as typeof fetch;
    await syncProjectIndexes({ root, fetcher: courseFetcher });
    const courseProject = JSON.parse(await readFile(file, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(courseProject).toMatchObject({
      projectType: 'COURSE_PROJECT',
      course: { courseId: 'software-engineering-project' },
      media: { coverImage: 'https://example.com/cover.png' }
    });
    expect(courseProject.courseOffering).toBeUndefined();

    const unchanged = await readFile(file, 'utf8');
    const invalidContent = Buffer.from(
      JSON.stringify({ id: 'forged-id' })
    ).toString('base64');
    const invalidFetcher = (async (url: string | URL | Request) =>
      String(url) === source.indexUrl
        ? Response.json({ content: invalidContent })
        : new Response(null, { status: 404 })) as typeof fetch;
    await expect(
      syncProjectIndexes({ root, fetcher: invalidFetcher })
    ).rejects.toThrow('index does not match');
    expect(await readFile(file, 'utf8')).toBe(unchanged);
  });
});
