#!/usr/bin/env python3
"""Compare SP caps in isolated committed source copies; all variants retain V11 soft40.
Run npm ci first. Each complete variant is 960 seeded production-AI battles.
The 60 bounded cadence probes per variant are NOT included in battle totals.
"""
from __future__ import annotations
import argparse, concurrent.futures, io, json, pathlib, shutil, subprocess, tarfile, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAPS = {
    'current': 'casterReserve(unit) ? 10 + 3 * unit.level : 6 + 2 * unit.level',
    'moderate': 'casterReserve(unit) ? 8 + 2 * unit.level : 5 + unit.level',
    'balanced': 'casterReserve(unit) ? 6 + 2 * unit.level : 4 + unit.level',
    'tight': 'casterReserve(unit) ? 4 + Math.ceil(1.5 * unit.level) : 3 + unit.level',
}
TARGET = "if (unit.resourceModel === 'endurance-v2') return " + CAPS['balanced'] + ';'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--phase', choices=['discovery', 'holdout'], default='discovery')
    parser.add_argument('--variants', default=','.join(CAPS))
    parser.add_argument('--ref', default='HEAD')
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    labels = args.variants.split(',')
    if len(labels) != len(set(labels)) or any(label not in CAPS for label in labels):
        parser.error('Unknown or duplicate variant')
    if not 1 <= args.workers <= 4:
        parser.error('workers must be 1..4')
    if not (ROOT / 'node_modules/vite-node/vite-node.mjs').exists():
        parser.error('Run npm ci before the audit')
    out = args.out.resolve() / args.phase
    if out.exists():
        parser.error('Output phase directory already exists; choose a fresh output to preserve evidence')
    archive = subprocess.check_output(['git', 'archive', args.ref], cwd=ROOT)
    commit = subprocess.check_output(['git', 'rev-parse', args.ref], cwd=ROOT, text=True).strip()
    out.mkdir(parents=True)
    (out / 'comparison-manifest.json').write_text(json.dumps({
        'sourceCommit': commit, 'phase': args.phase, 'variants': CAPS, 'selected': labels,
        'battlesPerVariant': 960, 'cadenceProbesPerVariant': 60,
        'offset': 161803 if args.phase == 'holdout' else 314159,
    }, indent=2))
    with tempfile.TemporaryDirectory(prefix='tb-sp-v11-') as temp:
        def run(label: str) -> dict:
            work = pathlib.Path(temp) / label
            work.mkdir()
            with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
                for member in tf.getmembers():
                    if member.name.startswith('/') or '..' in pathlib.PurePosixPath(member.name).parts or member.issym() or member.islnk():
                        raise ValueError('Unsafe archive member')
                tf.extractall(work)
            (work / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
            source_file = work / 'engine/src/resources.ts'
            source = source_file.read_text()
            if source.count(TARGET) != 1:
                raise ValueError('Source no longer matches the pinned V11 reserve; do not silently change the comparison')
            source_file.write_text(source.replace(TARGET, "if (unit.resourceModel === 'endurance-v2') return " + CAPS[label] + ';'))
            with (out / f'{label}-progress.log').open('w') as log:
                subprocess.run(['node', 'node_modules/vite-node/vite-node.mjs', 'scripts/audit-sp-v11.ts',
                                f'--label={label}', f'--out={out}', f'--phase={args.phase}'],
                               cwd=work, stdout=log, stderr=subprocess.STDOUT, check=True)
                subprocess.run(['node', 'node_modules/vite-node/vite-node.mjs', 'scripts/probe-sp-cadence.ts',
                                f'--out={out}/cadence-{label}.json'], cwd=work,
                               stdout=log, stderr=subprocess.STDOUT, check=True)
            rows = [json.loads(line) for line in (out / f'{label}-{args.phase}-0.jsonl').read_text().splitlines()]
            if len(rows) != 960 or len({r['id'] for r in rows}) != 960 or any('error' in r or not r.get('finished') for r in rows):
                raise RuntimeError(f'{label}: incomplete or duplicate battle evidence')
            return {'variant': label, 'battles': len(rows), 'errors': 0}
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            results = list(pool.map(run, labels))
        (out / 'completion.json').write_text(json.dumps(results, indent=2))
        print(json.dumps(results))


if __name__ == '__main__':
    main()
