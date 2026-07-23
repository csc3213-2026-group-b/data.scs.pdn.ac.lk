import { ProjectSchema } from '@csc3213-2026-group-b/academic-domain-schemas';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

interface ValidationResult {
  errors: string[];
  warnings: string[];
  counts: {
    projects: number;
  };
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

export async function validateProjectsData(
  root = process.cwd()
): Promise<ValidationResult> {
  const result: ValidationResult = {
    errors: [],
    warnings: [],
    counts: {
      projects: 0
    }
  };

  for (const requiredPath of [
    'public/projects/v1',
    'public/projects/v1/projects'
  ]) {
    if (!existsSync(path.join(root, requiredPath))) {
      result.errors.push(`${requiredPath}: missing required directory`);
    }
  }

  const aggregatePath = 'public/projects/v1/projects.json';
  const manifestPath = 'public/projects/v1/manifest.json';
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

    aggregateProjects.set(project.slug, project);
    result.counts.projects += 1;
  }

  const projectFiles = await listJsonFiles(root, 'public/projects/v1/projects');
  const seenProjectFiles = new Set<string>();
  for (const projectPath of projectFiles) {
    const value = await readJson(root, projectPath);
    const project = validateProject(result, projectPath, value);
    if (!project) continue;

    const expectedPath = `public/projects/v1/projects/${project.slug}.json`;
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
        `public/projects/v1/projects/${slug}.json: missing project file`
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
}
