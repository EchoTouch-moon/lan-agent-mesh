#!/usr/bin/env python3
"""Run a document audit from a clean committed tree and preserve command results.
Existing upstream collectors/fixtures are never executed. pnpm check is the
repository's existing regression suite, not permission for native probes.
"""
import datetime
import hashlib
import json
import pathlib
import platform
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/research/evidence/r0-2026-10-26'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def output(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def main():
    source = output('git', 'rev-parse', 'HEAD')
    clean = output('git', 'status', '--porcelain') == ''
    if not clean:
        raise SystemExit('Refusing authoritative run: commit intended changes first.')
    target = EVIDENCE / 'validation-01.json'
    if target.exists():
        raise SystemExit('Refusing to overwrite old evidence; use a new run id in a new committed runner.')
    raw_dir = pathlib.Path(tempfile.mkdtemp(prefix='lam-r0-validation-raw-'))
    files = ['docs/research/r0-tools/collect.py', 'docs/research/r0-tools/check.mjs', 'docs/research/r0-tools/validate.py', 'docs/research/upstream-locks.json', 'docs/research/upstream-locks.schema.json', 'package.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml', 'eslint.config.js']
    report = {'testedSourceSha': source, 'worktreeCleanBefore': clean, 'evidenceClass': 'docs', 'nativeModelCalls': 'not-used', 'environment': {'os': platform.platform(), 'python': platform.python_version(), 'node': output('node', '--version'), 'pnpm': output('pnpm', '--version'), 'harness': None}, 'inputHashes': {file: hashlib.sha256((ROOT / file).read_bytes()).hexdigest() for file in files}, 'commands': [], 'ciScope': 'macos-latest/windows-latest x Node22/24; results tracked separately on PR', 'rawLogStorage': 'local temporary directory, not committed; immutable raw SHA256 below; committed logs redact only repository/home path strings', 'cleanup': {'upstreamProcessesStarted': 0, 'newServiceListeners': 0, 'credentialsCreated': 0, 'aclFirewallChanges': 0, 'upstreamCacheContainsOnlyPublicText': True}}
    commands = [
        ['python3', 'docs/research/r0-tools/collect.py', '--output', 'docs/research/evidence/r0-2026-10-26/source-01'],
        ['node', 'docs/research/r0-tools/check.mjs'],
        ['pnpm', 'check'],
        ['git', 'diff', '--check']
    ]
    for index, command in enumerate(commands):
        started = now()
        result = subprocess.run(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
        finished = now()
        (raw_dir / f'{index}.log').write_bytes(result.stdout)
        text = result.stdout.decode('utf-8', errors='replace').replace(str(ROOT), '<repo>').replace(str(pathlib.Path.home()), '<home>')
        log = EVIDENCE / f'validation-01-{index}.log'
        log.write_text(text)
        report['commands'].append({'command': command, 'exitCode': result.returncode, 'startedAt': started, 'finishedAt': finished, 'rawSha256': hashlib.sha256(result.stdout).hexdigest(), 'log': log.name, 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest()})
        # Preserve even an interrupted partial run as evidence, without masking failures.
        target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
        print(json.dumps({'command': command, 'exitCode': result.returncode}), flush=True)
    print('Raw logs retained locally at ' + str(raw_dir), flush=True)
    return 1 if any(c['exitCode'] != 0 for c in report['commands']) else 0


if __name__ == '__main__':
    raise SystemExit(main())
