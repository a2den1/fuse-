/*
 * 릴리즈 도구.
 *
 *   npm run release:list           지금까지 나온 버전과 되돌리는 법
 *   npm run release -- patch       0.1.0 -> 0.1.1
 *   npm run release -- minor       0.1.0 -> 0.2.0
 *   npm run release -- major       0.1.0 -> 1.0.0
 *   npm run release -- 1.2.3       그 버전으로 직접 지정
 *
 * package.json 버전을 올리고, 커밋하고, vX.Y.Z 태그를 붙입니다.
 * 푸시는 하지 않습니다 — 마지막에 안내되는 명령을 확인하고 직접 하세요.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'package.json');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitQuiet = (...args) => {
  try { return git(...args); } catch { return ''; }
};

function readVersion() {
  return JSON.parse(fs.readFileSync(PKG, 'utf8')).version;
}

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = current.split('.').map(Number);
  if (kind === 'major') return (major + 1) + '.0.0';
  if (kind === 'minor') return major + '.' + (minor + 1) + '.0';
  if (kind === 'patch') return major + '.' + minor + '.' + (patch + 1);
  throw new Error('major / minor / patch 중 하나이거나 1.2.3 형식이어야 합니다. 받은 값: ' + kind);
}

/* ------------------------------ 목록 ------------------------------ */

function list() {
  const tags = gitQuiet('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean);
  const current = readVersion();

  console.log('현재 버전: v' + current + '\n');

  if (!tags.length) {
    console.log('아직 태그가 없습니다. `npm run release -- 0.1.0` 으로 첫 버전을 찍으세요.');
    return;
  }

  console.log('나온 버전:');
  for (const tag of tags) {
    const when = gitQuiet('log', '-1', '--format=%ad', '--date=short', tag);
    const subject = gitQuiet('log', '-1', '--format=%s', tag);
    console.log('  ' + tag.padEnd(10) + when + '  ' + subject);
  }

  console.log('\n되돌리기');
  console.log('  잠깐 살펴만 보기      git checkout ' + tags[0]);
  console.log('  그 버전으로 되돌리기   git revert --no-commit ' + tags[0] + '..HEAD && git commit -m "' + tags[0] + ' 로 되돌림"');
  console.log('  (되돌린 것도 이력으로 남아서 다시 앞으로 갈 수 있습니다)');
  console.log('  현재로 돌아오기       git checkout ' + (gitQuiet('rev-parse', '--abbrev-ref', 'HEAD') || 'main'));
}

/* ------------------------------ 릴리즈 ------------------------------ */

function release(kind) {
  if (gitQuiet('status', '--porcelain')) {
    console.error('커밋하지 않은 변경이 있습니다. 먼저 정리한 뒤 다시 실행하세요.\n');
    console.error(git('status', '--short'));
    process.exit(1);
  }

  const current = readVersion();
  const next = bump(current, kind);

  if (gitQuiet('tag', '--list', 'v' + next)) {
    console.error('v' + next + ' 태그가 이미 있습니다.');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  pkg.version = next;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');

  const changelog = path.join(ROOT, 'CHANGELOG.md');
  if (fs.existsSync(changelog) && !fs.readFileSync(changelog, 'utf8').includes('## [' + next + ']')) {
    console.log('\n※ CHANGELOG.md 에 [' + next + '] 항목이 없습니다. 무엇이 바뀌었는지 적어두면 나중에 찾기 쉽습니다.\n');
  }

  git('add', 'package.json');
  git('commit', '-m', 'v' + next);
  git('tag', '-a', 'v' + next, '-m', 'v' + next);

  console.log('v' + current + ' -> v' + next + ' 로 올리고 태그를 붙였습니다.\n');
  console.log('올리려면:');
  console.log('  git push origin HEAD --tags\n');
  console.log('깃허브 릴리즈까지 만들려면:');
  console.log('  gh release create v' + next + ' --title "v' + next + '" --notes-from-tag');
}

const arg = process.argv[2];
if (!arg || arg === 'list') list();
else release(arg);
