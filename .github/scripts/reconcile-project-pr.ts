import { readFile, writeFile } from 'node:fs/promises';

import {
  ProjectSchema,
  type Project
} from '@csc3213-2026-group-b/academic-domain-schemas';

interface ProjectManifest {
  version: string;
  updatedAt?: string;
  projects: ProjectManifestEntry[];
}

interface ProjectManifestEntry {
  id: string;
  slug: string;
  title: string;
  href: string;
}

const slug = process.argv[2]?.trim().toLowerCase();

if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  throw new Error('Usage: bun .github/scripts/reconcile-project-pr.ts <slug>');
}

const projectPath = `public/projects/v1/projects/${slug}.json`;
const aggregatePath = 'public/projects/v1/projects.json';
const manifestPath = 'public/projects/v1/manifest.json';

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function upsertProject(projects: unknown, project: Project): Project[] {
  const records = Array.isArray(projects) ? projects : [];
  const nextProjects = records.filter(
    (record): record is Project =>
      record !== null &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      (record as { slug?: unknown }).slug !== project.slug
  );

  nextProjects.push(project);
  return nextProjects.sort((left, right) =>
    left.title.localeCompare(right.title)
  );
}

function manifestEntryForProject(project: Project): ProjectManifestEntry {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    href: `projects/${project.slug}.json`
  };
}

function upsertManifest(
  manifest: unknown,
  project: Project,
  updatedAt = new Date().toISOString()
): ProjectManifest {
  const existing =
    manifest !== null &&
    typeof manifest === 'object' &&
    !Array.isArray(manifest)
      ? (manifest as Partial<ProjectManifest>)
      : {};
  const records = Array.isArray(existing.projects) ? existing.projects : [];
  const nextProjects = records.filter(
    (record): record is ProjectManifestEntry =>
      record !== null &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      (record as { slug?: unknown }).slug !== project.slug
  );

  nextProjects.push(manifestEntryForProject(project));

  return {
    version: typeof existing.version === 'string' ? existing.version : '1',
    updatedAt,
    projects: nextProjects.sort((left, right) =>
      left.title.localeCompare(right.title)
    )
  };
}

const project = ProjectSchema.parse(await readJson(projectPath));

if (project.slug !== slug) {
  throw new Error(`${projectPath}: project slug must match ${slug}`);
}

await writeJson(
  aggregatePath,
  upsertProject(await readJson(aggregatePath), project)
);
await writeJson(
  manifestPath,
  upsertManifest(await readJson(manifestPath), project)
);

console.log(`Reconciled project branch for ${slug}`);
