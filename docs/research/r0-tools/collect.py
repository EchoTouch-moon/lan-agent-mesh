#!/usr/bin/env python3
"""Read-only HTTPS evidence collector. Never imports/runs upstream code.
Output directory must be new: failures and previous runs are never overwritten.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import re
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
PATTERN = re.compile(r'UNKNOWN|UNSPECIFIED|TASK_STATE_|SendMessage|idempoten|cancel|auth|revok|licen|version|windows|macos|darwin|listen|0\.0\.0\.0|127\.0\.0\.1|insecure|dangerously|bypass|NotSupported|default_store|SetNamedSecurity|GRANT_ACCESS|cache|dependencies|jose|rust-version', re.I)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def fetch(url):
    start = now()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'LAM-R0-document-audit'}), timeout=45) as response:
            body = response.read()
            return {'url': url, 'startedAt': start, 'finishedAt': now(), 'httpStatus': response.status, 'sha256': hashlib.sha256(body).hexdigest()}, body
    except (urllib.error.URLError, TimeoutError) as error:
        return {'url': url, 'startedAt': start, 'finishedAt': now(), 'httpStatus': getattr(error, 'code', None), 'error': str(error)}, None


def collect(upstream):
    repo = upstream['url'].removeprefix('https://github.com/')
    commit = upstream['commit']
    pin, raw = fetch(upstream['pinEvidence'])
    pin['resolvedCommit'] = json.loads(raw)['sha'] if raw else None
    pin['matchesLock'] = pin['resolvedCommit'] == commit
    files = []
    for path in upstream['sourcePaths']:
        record, body = fetch(f'https://raw.githubusercontent.com/{repo}/{commit}/{path}')
        record['path'] = path
        if body is not None:
            record['gitBlobSha'] = hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest()
            lines = body.decode('utf-8').splitlines()
            chosen = set(range(min(8, len(lines))))
            for index, line in enumerate(lines):
                if PATTERN.search(line):
                    chosen.update(range(max(0, index - 1), min(len(lines), index + 2)))
            # Hash covers the entire fetched file; excerpts are navigation aids only.
            record['lineCount'] = len(lines)
            record['excerpts'] = [{'line': index + 1, 'text': lines[index]} for index in sorted(chosen)[:60]]
        files.append(record)
    return {'id': upstream['id'], 'repository': repo, 'commit': commit, 'pin': pin, 'files': files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    locks = json.loads((ROOT / 'docs/research/upstream-locks.json').read_text())
    # AgentBridge shares the identical workspace source pin and sources with SHADI.
    targets = [x for x in locks['upstreams'] if x['id'] != 'agentbridge']
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(collect, targets))
    npm = []
    for package, version in [('@a2a-js/sdk', '1.3.0'), ('jose', '6.2.13'), ('@modelcontextprotocol/server', '2.4.0'), ('@modelcontextprotocol/client', '2.4.0'), ('@modelcontextprotocol/core', '2.4.0')]:
        record, body = fetch(f'https://registry.npmjs.org/{package}/{version}')
        if body:
            data = json.loads(body)
            record['metadata'] = {key: data.get(key) for key in ['name', 'version', 'license', 'gitHead', 'engines', 'dependencies', 'peerDependencies', 'peerDependenciesMeta']}
            record['dist'] = {key: data.get('dist', {}).get(key) for key in ['tarball', 'shasum', 'integrity', 'attestations']}
        npm.append(record)
    failed = [r['pin'] for r in results if not r['pin']['matchesLock']]
    failed += [f for r in results for f in r['files'] if 'error' in f]
    failed += [r for r in npm if 'error' in r]
    output = {'collectedAt': now(), 'evidenceClass': 'documented', 'executedUpstreamCode': False, 'sources': results, 'npm': npm, 'failures': failed}
    (args.output / 'sources.json').write_text(json.dumps(output, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'repositories': len(results), 'files': sum(len(x['files']) for x in results), 'npmRecords': len(npm), 'failures': len(failed), 'output': str(args.output / 'sources.json')}))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
