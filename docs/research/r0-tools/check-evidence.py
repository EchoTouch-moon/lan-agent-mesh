#!/usr/bin/env python3
"""Offline cross-check of the final lock against both immutable source captures."""
import json
import sys
sys.dont_write_bytecode = True
from collect import ROOT


def main():
    base = ROOT / 'docs/research/evidence/r0-2026-10-26'
    locks = json.loads((ROOT / 'docs/research/upstream-locks.json').read_text())
    captures = [json.loads((base / f'source-0{n}/sources.json').read_text()) for n in [1, 2]]
    files = {}
    for capture in captures:
        assert capture['failures'] == []
        assert capture['executedUpstreamCode'] is False
        for source in capture['sources']:
            assert source['pin']['httpStatus'] == 200
            assert source['pin']['matchesLock'] is True
            for file in source['files']:
                assert file['httpStatus'] == 200
                assert len(file['sha256']) == 64
                assert len(file['gitBlobSha']) == 40
                files[source['repository'], source['commit'], file['path']] = file
    for upstream in locks['upstreams']:
        repo = upstream['url'].removeprefix('https://github.com/')
        for path in upstream['sourcePaths']:
            file = files[repo, upstream['commit'], path]
            assert file['url'] == f'https://raw.githubusercontent.com/{repo}/{upstream["commit"]}/{path}'
        license_path = next(p for p in upstream['sourcePaths'] if p.startswith('LICENSE'))
        text = '\n'.join(x['text'] for x in files[repo, upstream['commit'], license_path]['excerpts'])
        if upstream['id'] == 'mcp':
            assert all(term in text for term in ['MIT', 'Apache', 'CC-BY-4.0'])
        elif upstream['license'] == 'MIT':
            assert 'MIT License' in text
        else:
            assert 'Apache License' in text and 'Version 2.0' in text
    npm = {item['metadata']['name']: item for item in captures[0]['npm']}
    sdk = next(x for x in locks['upstreams'] if x['id'] == 'a2a-js')
    assert npm['@a2a-js/sdk']['metadata']['gitHead'] == sdk['commit']
    assert npm['@a2a-js/sdk']['metadata']['version'] == '1.3.0'
    assert all(item['httpStatus'] == 200 and item['dist']['integrity'] for item in npm.values())
    print(f'PASS {len(locks["upstreams"])} lock entries and {len(files)} source files have captured pin/API/license evidence')
    print('PASS A2A npm gitHead matches source pin; MCP npm gitHead absent: artifact-to-source binding remains unknown')
    print('No tarball contents, signature, transitive-license or vulnerability audit claimed.')


if __name__ == '__main__':
    main()
