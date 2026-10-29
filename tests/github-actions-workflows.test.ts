import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const workflowsRoot = path.join(root, '.github', 'workflows');

async function workflow(name: string) {
  return (await readFile(path.join(workflowsRoot, name), 'utf8')).replaceAll(
    '\r\n',
    '\n'
  );
}

describe('GitHub Actions trust boundaries', () => {
  test('uses the private canonical schemas package without legacy sources', async () => {
    const packageSource = await readFile(
      path.join(root, 'package.json'),
      'utf8'
    );
    const scriptNames = [
      'reconcile-project-pr.ts',
      'validate-academic-data.ts',
      'validate-people-data.ts',
      'validate-projects-data.ts'
    ];

    expect(packageSource).not.toContain(
      '@csc3213-2026-group-b/academic-domain-schemas'
    );
    expect(packageSource).toContain(
      '"@csc3213-2026-group-b/scs-schemas": "0.3.1"'
    );

    for (const scriptName of scriptNames) {
      const source = await readFile(
        path.join(root, '.github', 'scripts', scriptName),
        'utf8'
      );
      expect(source).toContain("from '@csc3213-2026-group-b/scs-schemas'");
      expect(source).not.toContain("from '@scs/schemas'");
      expect(source).not.toContain(
        '@csc3213-2026-group-b/academic-domain-schemas'
      );
    }

    for (const workflowName of [
      'validate-public-data.yml',
      'publish-public-projections.yml',
      'update-public-projections.yml',
      'deploy.yml'
    ]) {
      const source = await workflow(workflowName);
      expect(source).toContain('packages: read');
      expect(source).toContain('NODE_AUTH_TOKEN: ${{ github.token }}');
      expect(source).toContain(
        'bun --config="$RUNNER_TEMP/bunfig.toml" install --frozen-lockfile --ignore-scripts'
      );
      expect(source).not.toContain(
        'bun install --frozen-lockfile --ignore-scripts'
      );
      expect(source).not.toContain('submodules: recursive');
    }
  });

  test('keeps the required validation workflow read-only', async () => {
    const source = await workflow('validate-public-data.yml');

    expect(source).toContain('permissions:\n  contents: read');
    expect(source).toContain('persist-credentials: false');
    expect(source).not.toContain('contents: write');
    expect(source).not.toContain('bun run generate\n');
    expect(source).not.toContain('git push');
  });

  test('isolates trusted projection updates from pull request code', async () => {
    const source = await workflow('update-public-projections.yml');

    expect(source).toContain('pull_request_target:');
    expect(source).toContain(
      'permissions:\n  contents: read\n  packages: read\n  pull-requests: read'
    );
    expect(source).toContain(
      "github.event.pull_request.user.login == 'scs-portal-github-app[bot]'"
    );
    expect(source).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    );
    expect(source).toContain('actions/create-github-app-token@');
    expect(source).toContain('permission-contents: write');
    expect(source).toContain('path: trusted');
    expect(source).toContain('path: candidate');
    expect(source).toContain(
      'bun ../trusted/.github/scripts/generate-public-projections.ts'
    );
    expect(source).toContain(
      '--force-with-lease="refs/heads/$HEAD_REF:$HEAD_SHA"'
    );
    expect(source).not.toContain('pull-requests: write');
  });

  test('uses the current maintained major for every referenced action', async () => {
    const workflowFiles = (await readdir(workflowsRoot)).filter((name) =>
      /\.ya?ml$/.test(name)
    );
    const allowedReferences = new Set([
      'actions/checkout@v7',
      'actions/create-github-app-token@v3',
      'cloudflare/wrangler-action@v4',
      'oven-sh/setup-bun@v2'
    ]);

    for (const name of workflowFiles) {
      const source = await workflow(name);
      const references = [
        ...source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)
      ];

      for (const [, reference] of references) {
        expect(allowedReferences.has(reference), `${name}: ${reference}`).toBe(
          true
        );
      }
    }
  });

  test('deploys only the exact successful validated main commit', async () => {
    const source = await workflow('deploy.yml');

    expect(source).toContain(
      "github.event.workflow_run.conclusion == 'success'"
    );
    expect(source).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(source).toContain('github.event.workflow_run.head_sha');
    expect(source).toContain('id: deployment-ref');
    expect(source).toContain(
      'current_sha="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main"'
    );
    expect(source).toContain(
      'if [[ -n "$VALIDATED_SHA" && "$VALIDATED_SHA" != "$current_sha" ]]'
    );
    expect(source).toContain('needs: freshness');
    expect(source).toContain('needs: [freshness, validate]');
    expect(
      source.match(/ref: \$\{\{ needs\.freshness\.outputs\.ref \}\}/g)
    ).toHaveLength(2);
    expect(source).not.toContain('ref: ${{ env.DEPLOY_REF }}');
    expect(source).not.toContain('pull_request_target:');
    expect(
      source.match(/NODE_AUTH_TOKEN: \$\{\{ github\.token \}\}/g)
    ).toHaveLength(2);
    expect(source.lastIndexOf('- name: Install dependencies')).toBeLessThan(
      source.indexOf('uses: cloudflare/wrangler-action@v4')
    );
  });

  test('uses the installed App for every privileged pull request mutation', async () => {
    const autoMerge = await workflow('auto-merge-profile-pr.yml');
    const recovery = await workflow('publish-public-projections.yml');
    const updater = await workflow('update-public-projections.yml');

    for (const source of [autoMerge, recovery, updater]) {
      expect(source).toContain('actions/create-github-app-token@');
      expect(source).toContain(
        'client-id: ${{ vars.SCS_PORTAL_GITHUB_APP_CLIENT_ID }}'
      );
      expect(source).not.toContain('app-id:');
      expect(source).toContain(
        'private-key: ${{ secrets.SCS_PORTAL_GITHUB_APP_PRIVATE_KEY }}'
      );
      expect(source).toContain(
        'GH_TOKEN: ${{ steps.app-token.outputs.token }}'
      );
    }

    expect(autoMerge).toContain(
      '[[ "$author" != "app/scs-portal-github-app" ]]'
    );
    expect(autoMerge).toContain(
      'permissions:\n  contents: read\n  pull-requests: read'
    );
    expect(autoMerge).toContain(
      'group: ${{ github.workflow }}-${{ github.event.pull_request.number }}-${{ github.event.label.name }}'
    );
    expect(recovery).toContain(
      "if: steps.changes.outputs.changed == 'true'\n        id: app-token"
    );
    expect(recovery.indexOf('id: changes')).toBeLessThan(
      recovery.indexOf('id: app-token')
    );
  });
});
