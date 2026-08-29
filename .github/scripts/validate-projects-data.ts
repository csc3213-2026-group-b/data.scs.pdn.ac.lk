import { ProjectSchema } from '@csc3213-2026-group-b/academic-domain-schemas';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAcademicRegistry } from './validate-academic-data.js';

type JsonRecord = Record<string, unknown>;

interface ValidationResult {
  errors: string[];
  warnings: string[];
  counts: {
    projects: number;
    projectPeopleIndexes: number;
  };
}

interface ProjectByPersonEntry {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  projectType: string;
  status: string;
  categories: string[];
  tags: string[];
  academicYear?: string | number;
  role: string;
  href: string;
  lastUpdatedAt: string;
}

function toPosix(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}

async function readJson(root: string, relativePath: string) {
  const absolutePath = path.join(root, relativePath);
  const content = await readFile(absolutePath, 'utf8');
  return JSON.parse(content) as unknown;
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

function validateProject(
  result: ValidationResult,
  relativePath: string,
  value: unknown
) {
  const parsed = ProjectSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  for (const issue of parsed.error.issues) {
    const issuePath = issue.path.length ? `.${issue.path.join('.')}` : '';
    result.errors.push(`${relativePath}${issuePath}: ${issue.message}`);
  }
  return null;
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function byPersonEntry(
  project: NonNullable<ReturnType<typeof validateProject>>,
  role: string
): ProjectByPersonEntry {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    shortDescription: project.shortDescription,
    projectType: project.projectType,
    status: project.status,
    categories: project.categories,
    tags: project.tags,
    ...(project.academicYear ? { academicYear: project.academicYear } : {}),
    role,
    href: `projects/${project.slug}.json`,
    lastUpdatedAt: project.dates.lastUpdatedAt
  };
}

function buildExpectedByPersonIndexes(
  projects: Map<string, NonNullable<ReturnType<typeof validateProject>>>
) {
  const indexes = new Map<string, ProjectByPersonEntry[]>();

  for (const project of projects.values()) {
    for (const person of project.people) {
      const username = normalizeUsername(person.username);
      if (!username) continue;

      const entries = indexes.get(username) ?? [];
      entries.push(byPersonEntry(project, person.role));
      indexes.set(username, entries);
    }
  }

  for (const entries of indexes.values()) {
    entries.sort(
      (left, right) =>
        left.title.localeCompare(right.title) ||
        left.slug.localeCompare(right.slug)
    );
  }

  return indexes;
}

function validateByPersonEntry(
  result: ValidationResult,
  relativePath: string,
  value: unknown
): ProjectByPersonEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    result.errors.push(`${relativePath}: expected a JSON object`);
    return null;
  }

  if ('email' in value) {
    result.errors.push(`${relativePath}.email: must not be published`);
  }

  const record = value as Partial<ProjectByPersonEntry>;
  const stringFields = [
    'id',
    'slug',
    'title',
    'shortDescription',
    'projectType',
    'status',
    'role',
    'href',
    'lastUpdatedAt'
  ] as const;

  for (const field of stringFields) {
    if (typeof record[field] !== 'string' || !record[field]?.trim()) {
      result.errors.push(
        `${relativePath}.${field}: expected a non-empty string`
      );
    }
  }

  for (const field of ['categories', 'tags'] as const) {
    if (
      !Array.isArray(record[field]) ||
      !record[field]?.every((item) => typeof item === 'string' && item.trim())
    ) {
      result.errors.push(`${relativePath}.${field}: expected a string array`);
    }
  }

  if (
    record.academicYear !== undefined &&
    !(
      (typeof record.academicYear === 'string' && record.academicYear.trim()) ||
      typeof record.academicYear === 'number'
    )
  ) {
    result.errors.push(
      `${relativePath}.academicYear: expected a string or number`
    );
  }

  return record as ProjectByPersonEntry;
}

export async function validateProjectsData(
  root = process.cwd()
): Promise<ValidationResult> {
  const result: ValidationResult = {
    errors: [],
    warnings: [],
    counts: {
      projects: 0,
      projectPeopleIndexes: 0
    }
  };

  for (const requiredPath of [
    'public/projects/v2',
    'public/projects/v2/projects',
    'public/projects/v2/by-person'
  ]) {
    if (!existsSync(path.join(root, requiredPath))) {
      result.errors.push(`${requiredPath}: missing required directory`);
    }
  }

  const aggregatePath = 'public/projects/v2/projects.json';
  const manifestPath = 'public/projects/v2/manifest.json';
  const academicRegistry = await loadAcademicRegistry(root, result);
  const aggregateValue = existsSync(path.join(root, aggregatePath))
    ? await readJson(root, aggregatePath)
    : [];

  if (!Array.isArray(aggregateValue)) {
    result.errors.push(`${aggregatePath}: expected a JSON array`);
    return result;
  }

  const aggregateProjects = new Map<string, JsonRecord>();
  for (const [index, value] of aggregateValue.entries()) {
    const project = validateProject(
      result,
      `${aggregatePath}[${index}]`,
      value
    );
    if (!project) continue;

    if (aggregateProjects.has(project.slug)) {
      result.errors.push(`${aggregatePath}[${index}]: duplicate project slug`);
    }

    if (project.projectType === 'COURSE_PROJECT') {
      const courseOffering = (value as JsonRecord).courseOffering;
      const offeringId =
        courseOffering &&
        typeof courseOffering === 'object' &&
        !Array.isArray(courseOffering)
          ? (courseOffering as { id?: unknown }).id
          : undefined;

      if (typeof offeringId !== 'string' || !offeringId.trim()) {
        result.errors.push(
          `${aggregatePath}[${index}].courseOffering.id: required for course projects`
        );
      } else if (!academicRegistry.offerings.has(offeringId)) {
        result.errors.push(
          `${aggregatePath}[${index}].courseOffering.id: missing referenced offering`
        );
      }
    }

    aggregateProjects.set(project.slug, project);
    result.counts.projects += 1;
  }

  const projectFiles = await listJsonFiles(root, 'public/projects/v2/projects');
  const seenProjectFiles = new Set<string>();
  for (const projectPath of projectFiles) {
    const value = await readJson(root, projectPath);
    const project = validateProject(result, projectPath, value);
    if (!project) continue;

    const expectedPath = `public/projects/v2/projects/${project.slug}.json`;
    seenProjectFiles.add(project.slug);
    if (projectPath !== expectedPath) {
      result.errors.push(
        `${projectPath}: filename does not match project slug "${project.slug}"`
      );
    }

    const aggregateProject = aggregateProjects.get(project.slug);
    if (!aggregateProject) {
      result.errors.push(`${projectPath}: missing from ${aggregatePath}`);
    } else if (stableJson(project) !== stableJson(aggregateProject)) {
      result.errors.push(`${projectPath}: differs from ${aggregatePath}`);
    }
  }

  for (const slug of aggregateProjects.keys()) {
    if (!seenProjectFiles.has(slug)) {
      result.errors.push(
        `public/projects/v2/projects/${slug}.json: missing project file`
      );
    }
  }

  const expectedByPerson = buildExpectedByPersonIndexes(
    aggregateProjects as Map<
      string,
      NonNullable<ReturnType<typeof validateProject>>
    >
  );
  const byPersonFiles = await listJsonFiles(
    root,
    'public/projects/v2/by-person'
  );
  const seenByPersonUsernames = new Set<string>();

  for (const byPersonPath of byPersonFiles) {
    const username = path.basename(byPersonPath, '.json');
    seenByPersonUsernames.add(username);

    if (username !== normalizeUsername(username)) {
      result.errors.push(
        `${byPersonPath}: username filename must be lowercase`
      );
    }

    const value = await readJson(root, byPersonPath);
    if (!Array.isArray(value)) {
      result.errors.push(`${byPersonPath}: expected a JSON array`);
      continue;
    }

    const entries = value
      .map((entry, index) =>
        validateByPersonEntry(result, `${byPersonPath}[${index}]`, entry)
      )
      .filter((entry): entry is ProjectByPersonEntry => Boolean(entry));
    const expected = expectedByPerson.get(username) ?? [];

    if (stableJson(entries) !== stableJson(expected)) {
      result.errors.push(
        `${byPersonPath}: differs from generated project people index`
      );
    }

    result.counts.projectPeopleIndexes += 1;
  }

  for (const username of expectedByPerson.keys()) {
    if (!seenByPersonUsernames.has(username)) {
      result.errors.push(
        `public/projects/v2/by-person/${username}.json: missing project people index`
      );
    }
  }

  if (existsSync(path.join(root, manifestPath))) {
    const manifest = await readJson(root, manifestPath);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      result.errors.push(`${manifestPath}: expected a JSON object`);
    } else {
      const projects = (manifest as { projects?: unknown }).projects;
      if (!Array.isArray(projects)) {
        result.errors.push(`${manifestPath}.projects: expected a JSON array`);
      }
    }
  } else {
    result.errors.push(`${manifestPath}: missing manifest file`);
  }

  return result;
}

if (import.meta.main) {
  const result = await validateProjectsData();

  for (const warning of result.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (result.errors.length) {
    console.error('Projects data validation failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Projects data validation passed.');
  console.log(`projects=${result.counts.projects}`);
  console.log(`projectPeopleIndexes=${result.counts.projectPeopleIndexes}`);
}
