import {
  ProjectIndexSchema,
  ProjectSchema
} from '@csc3213-2026-group-b/scs-schemas';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { format } from 'prettier';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function indexUrl(project: JsonRecord): string | null {
  const source = project.source;
  if (!record(source) || source.kind === 'MANUAL') return null;
  if (
    typeof source.repositoryOwner !== 'string' ||
    typeof source.repositoryName !== 'string' ||
    !/^[a-z\d][a-z\d._-]*$/i.test(source.repositoryOwner) ||
    !/^[a-z\d][a-z\d._-]*$/i.test(source.repositoryName)
  )
    throw new Error('Invalid repository coordinates');
  if (
    source.kind === 'TEMPLATE_INDEX_JSON' &&
    source.metadataPath !== '.docs/index.json'
  )
    throw new Error('Unsupported repository index path');
  const expected = `https://api.github.com/repos/${source.repositoryOwner}/${source.repositoryName}/contents/.docs/index.json`;
  if (source.indexUrl !== undefined && source.indexUrl !== expected)
    throw new Error('Repository index URL does not match source coordinates');
  return expected;
}

export async function syncProjectIndexes(
  options: {
    root?: string;
    fetcher?: typeof fetch;
    token?: string;
  } = {}
): Promise<string[]> {
  const root = options.root ?? process.cwd();
  const fetcher = options.fetcher ?? fetch;
  const directory = path.join(root, 'public/projects/v2/projects');
  const entries = (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (entries.length > 500)
    throw new Error('Project index sync exceeds the 500-project limit');
  const updates: Array<{ file: string; content: string }> = [];

  for (const entry of entries) {
    const file = path.join(directory, entry);
    const original = await readFile(file, 'utf8');
    const project: unknown = JSON.parse(original);
    if (!record(project))
      throw new Error(`${entry}: expected a project object`);
    const url = indexUrl(project);
    if (!url) continue;
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      signal: AbortSignal.timeout(5000)
    });
    if (response.status === 404) continue;
    if (!response.ok)
      throw new Error(`${entry}: index request failed (${response.status})`);
    const payload: unknown = await response.json();
    if (
      !record(payload) ||
      typeof payload.content !== 'string' ||
      payload.content.length > 45000
    ) {
      throw new Error(`${entry}: invalid or oversized index response`);
    }
    const decoded = Buffer.from(
      payload.content.replace(/\s/g, ''),
      'base64'
    ).toString('utf8');
    if (decoded.length > 32000)
      throw new Error(`${entry}: index exceeds 32 KiB`);
    const metadata: unknown = JSON.parse(decoded);
    const parsedIndex = ProjectIndexSchema.safeParse(metadata);
    if (!parsedIndex.success)
      throw new Error(
        `${entry}: index does not match the project index schema`
      );
    const index = parsedIndex.data;
    const indexSource =
      record(index.source) && record(metadata) && record(metadata.source)
        ? {
            ...index.source,
            ...(typeof metadata.source.indexUrl === 'string'
              ? { indexUrl: metadata.source.indexUrl }
              : {})
          }
        : index.source;
    const merged: JsonRecord = {
      ...project,
      ...index,
      ...(indexSource ? { source: indexSource } : {}),
      links: {
        ...(record(project.links) ? project.links : {}),
        ...(record(index.links) ? index.links : {})
      },
      media: {
        ...(record(project.media) ? project.media : {}),
        ...(record(index.media) ? index.media : {})
      },
      dates: {
        ...(record(project.dates) ? project.dates : {}),
        ...(record(index.dates) ? index.dates : {})
      },
      ...(record(project.course) && record(index.course)
        ? { course: { ...project.course, ...index.course } }
        : {}),
      id: project.id,
      slug: project.slug
    };
    indexUrl(merged);
    const validated = ProjectSchema.safeParse(merged);
    if (!validated.success)
      throw new Error(`${entry}: index does not produce a valid project`);
    const validatedSource = record(validated.data.source)
      ? validated.data.source
      : {};
    const mergedSource = record(merged.source) ? merged.source : {};
    const nextProject = {
      ...validated.data,
      source: {
        ...validatedSource,
        ...(typeof mergedSource.indexUrl === 'string'
          ? { indexUrl: mergedSource.indexUrl }
          : {})
      }
    };
    const content = await format(JSON.stringify(nextProject), {
      parser: 'json',
      printWidth: 80,
      singleQuote: true,
      trailingComma: 'none',
      endOfLine: original.includes('\r\n') ? 'crlf' : 'lf'
    });
    if (content !== original) updates.push({ file, content });
  }

  // Validate every remote index before writing any authoritative file.
  for (const update of updates) await writeFile(update.file, update.content);
  return updates.map((update) => path.basename(update.file));
}

if (import.meta.main) {
  const changed = await syncProjectIndexes({ token: process.env.GH_TOKEN });
  console.log(
    `Updated ${changed.length} project records from repository indexes.`
  );
}
