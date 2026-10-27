#!/usr/bin/env python3
"""Collect only newly added source paths, preserving source-01 verbatim."""
import concurrent.futures
import json
import sys
sys.dont_write_bytecode = True
from collect import ROOT, collect, now


def main():
    base = ROOT / 'docs/research/evidence/r0-2026-10-26'
    previous = json.loads((base / 'source-01/sources.json').read_text())
    known = {item['id']: {file['path'] for file in item['files']} for item in previous['sources']}
    locks = json.loads((ROOT / 'docs/research/upstream-locks.json').read_text())
    targets = []
    for upstream in locks['upstreams']:
        if upstream['id'] == 'agentbridge':
            continue
        missing = [path for path in upstream['sourcePaths'] if path not in known[upstream['id']]]
        if missing:
            targets.append(dict(upstream, sourcePaths=missing))
    destination = base / 'source-02'
    destination.mkdir(exist_ok=False)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        sources = list(pool.map(collect, targets))
    failures = [source['pin'] for source in sources if not source['pin']['matchesLock']]
    failures += [file for source in sources for file in source['files'] if 'error' in file]
    report = {'collectedAt': now(), 'evidenceClass': 'documented', 'executedUpstreamCode': False, 'sources': sources, 'failures': failures}
    (destination / 'sources.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'supplementalFiles': sum(len(source['files']) for source in sources), 'failures': len(failures)}))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
