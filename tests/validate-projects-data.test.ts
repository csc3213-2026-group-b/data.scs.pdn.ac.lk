import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateProjectsData } from '../.github/scripts/validate-projects-data.js';

const project = {
  id: 'prj-scholarship-system',
  slug: 'scholarship-management-system',
  title: 'Scholarship Management System',
  shortDescription: 'A workflow platform for scholarship applications.',
  description:
    'This department-facing system organizes scholarship applications from intake to review.',
  projectType: 'DEPARTMENT_SYSTEM',
  status: 'ACTIVE',
  categories: ['department-systems', 'student-services'],
  tags: ['Next.js', 'Workflow'],
  academicYear: '2025/2026',
  course: {
    courseId: 'software-engineering-project',
    offeringId: 'csc3213-2025-2026-sem2',
    code: 'CSC3213',
    title: 'Software Systems Design Project',
    academicYear: '2025/2026',
    semester: 'SEM2'
  },
  courseOffering: {
    id: 'csc3213-2025-2026-sem2'
  },
  people: [
    {
      name: 'CSC3213 Group B',
      role: 'student',
      username: 's21sp001'
    }
  ],
  links: {
    repository: 'https://github.com/csc3213-2026-group-b'
  },
  source: {
    kind: 'MANUAL',
    curator: 'SCS Project Registry'
  },
  media: {
    icon: 'GraduationCap'
  },
  dates: {
    startedAt: '2026-05-01',
    lastUpdatedAt: '2026-07-23'
  }
};

let tempRoots: string[] = [];

async function makeRoot() {
  const root = path.join(
    os.tmpdir(),
    `data-scs-projects-validation-${crypto.randomUUID()}`
  );
  tempRoots.push(root);
  await mkdir(path.join(root, 'public/projects/v2/projects'), {
    recursive: true
  });
  await mkdir(path.join(root, 'public/projects/v2/by-person'), {
    recursive: true
  });
  await mkdir(path.join(root, 'public/academic/v2/courses'), {
    recursive: true
  });
  await mkdir(path.join(root, 'public/academic/v2/offerings'), {
    recursive: true
  });
  await writeJson(root, 'public/academic/v2/courses.json', [
    {
      id: 'software-engineering-project',
      primaryCode: 'CSC3213',
      codes: ['CSC3213'],
      title: 'Software Systems Design Project',
      credits: 3
    }
  ]);
  await writeJson(root, 'public/academic/v2/offerings.json', [
    {
      id: 'csc3213-2025-2026-sem2',
      courseId: 'software-engineering-project',
      academicYear: '2025/2026',
      semester: 'SEM2',
      staff: []
    }
  ]);
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

describe('validateProjectsData', () => {
  test('accepts consistent project aggregate and detail files', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/projects/v2/manifest.json', {
      version: 'v1',
      projects: [
        {
          id: project.id,
          slug: project.slug,
          title: project.title,
          projectType: project.projectType,
          status: project.status,
          academicYear: project.academicYear,
          lastUpdatedAt: project.dates.lastUpdatedAt
        }
      ]
    });
    await writeJson(root, 'public/projects/v2/projects.json', [project]);
    await writeJson(
      root,
      'public/projects/v2/projects/scholarship-management-system.json',
      project
    );
    await writeJson(root, 'public/projects/v2/by-person/s21sp001.json', [
      {
        id: project.id,
        slug: project.slug,
        title: project.title,
        shortDescription: project.shortDescription,
        projectType: project.projectType,
        status: project.status,
        categories: project.categories,
        tags: project.tags,
        academicYear: project.academicYear,
        role: project.people[0].role,
        href: `projects/${project.slug}.json`,
        lastUpdatedAt: project.dates.lastUpdatedAt
      }
    ]);

    const result = await validateProjectsData(root);

    expect(result.errors).toEqual([]);
    expect(result.counts.projects).toBe(1);
    expect(result.counts.projectPeopleIndexes).toBe(1);
  });

  test('rejects stale project detail files', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/projects/v2/manifest.json', {
      version: 'v1',
      projects: []
    });
    await writeJson(root, 'public/projects/v2/projects.json', [project]);
    await writeJson(
      root,
      'public/projects/v2/projects/scholarship-management-system.json',
      {
        ...project,
        title: 'Different title'
      }
    );

    const result = await validateProjectsData(root);

    expect(result.errors).toContain(
      'public/projects/v2/projects/scholarship-management-system.json: differs from public/projects/v2/projects.json'
    );
  });

  test('rejects course projects with missing offerings', async () => {
    const root = await makeRoot();
    await writeJson(root, 'public/academic/v2/offerings.json', []);
    await writeJson(root, 'public/projects/v2/manifest.json', {
      version: 'v1',
      projects: []
    });
    await writeJson(root, 'public/projects/v2/projects.json', [
      {
        ...project,
        projectType: 'COURSE_PROJECT'
      }
    ]);

    const result = await validateProjectsData(root);

    expect(result.errors).toContain(
      'public/projects/v2/projects.json[0].courseOffering.id: missing referenced offering'
    );
  });
});
