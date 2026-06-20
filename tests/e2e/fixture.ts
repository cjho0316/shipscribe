import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A disposable git repo the E2E server points at via SHIPSCRIBE_REPO, so the
 * streaming run shows real commits/SHAs and the "Apply to CHANGELOG" test writes
 * into THIS throwaway repo — never the project's own CHANGELOG.md.
 */
export const FIXTURE_REPO = path.join(os.tmpdir(), 'shipscribe-e2e-repo');

function git(args: string[]): void {
  execFileSync('git', args, { cwd: FIXTURE_REPO, stdio: 'ignore' });
}

function commit(message: string, file: string, body: string): void {
  writeFileSync(path.join(FIXTURE_REPO, file), body);
  git(['add', '-A']);
  git([
    '-c', 'user.email=e2e@shipscribe.local',
    '-c', 'user.name=ShipScribe E2E',
    '-c', 'commit.gpgsign=false',
    'commit', '-m', message,
  ]);
}

/** (Re)create the fixture repo with a tagged baseline + a breaking change. */
export function createFixtureRepo(): void {
  rmSync(FIXTURE_REPO, { recursive: true, force: true });
  mkdirSync(FIXTURE_REPO, { recursive: true });
  git(['init', '-q', '-b', 'main']);

  commit('feat: initial greeting CLI', 'cli.txt', 'v1\n'); // baseline
  git(['tag', 'v0.1.0']); // getDefaultRange() -> v0.1.0..HEAD

  commit('feat: add --json output flag', 'cli.txt', 'v2 json\n');
  commit('fix: prevent crash on empty name input', 'cli.txt', 'v3 guard\n');
  commit('feat!: rename greet to hello', 'cli.txt', 'v4 hello\n'); // breaking
  commit('docs: document the greeting CLI', 'README.md', '# demo\n');
}
