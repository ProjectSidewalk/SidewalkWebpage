#!/usr/bin/env python3
"""#5667: one dimension per DC pano from the three sources, with provenance and a conflict report. Runs locally.

    python3 5667-join-dims.py --panos dc-labelled-panos.csv --store 5667-dc-store.csv \
        --photometa dc-sweep/chunk-*.csv --out 5667-dc-dims.csv

Precedence: cbk sidecar (Google's metadata at scrape time) > photometa (what Google serves now) > stored JPEG header.
A pano never changes size, so the three must agree wherever they overlap; any disagreement is listed and the pano is
left unresolved rather than guessed (a JPEG that disagrees with a sidecar or photometa is a mis-stitched file).
`--panos` is the list of labelled DC pano ids (one `pano_id` column), so coverage is reported against what matters.
"""
import argparse, csv, glob
from collections import Counter


def read(paths):
    rows = []
    for p in paths:
        with open(p, newline='') as f:
            rows += list(csv.DictReader(f))
    return rows


def dims(r, w, h):
    return (int(r[w]), int(r[h])) if r.get(w) and r.get(h) else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panos', required=True)
    ap.add_argument('--store', required=True)
    ap.add_argument('--photometa', nargs='+', required=True)
    ap.add_argument('--out', default='5667-dc-dims.csv')
    args = ap.parse_args()

    wanted = [r['pano_id'] for r in read([args.panos])]
    store = {r['pano_id']: r for r in read([args.store])}
    meta = {r['pano_id']: r for r in read(sum((glob.glob(p) for p in args.photometa), [])) if r.get('status') == 'OK'}
    gone = {r['pano_id'] for r in read(sum((glob.glob(p) for p in args.photometa), [])) if r.get('status') == 'NOT_FOUND'}

    out, conflicts, why = [], [], Counter()
    for pano_id in wanted:
        s, m = store.get(pano_id, {}), meta.get(pano_id)
        xml, jpg = dims(s, 'xml_w', 'xml_h'), dims(s, 'jpeg_w', 'jpeg_h')
        pm = dims(m, 'width', 'height') if m else None
        known = [d for d in (xml, pm) if d]
        if known and len(set(known)) > 1:
            conflicts.append((pano_id, 'sidecar vs photometa', xml, pm)); why['conflict'] += 1; continue
        if jpg and known and jpg != known[0]:
            conflicts.append((pano_id, 'jpeg vs ' + ('sidecar' if xml else 'photometa'), jpg, known[0]))
            why['jpeg mis-stitched (ignored)'] += 1
        chosen, src = (xml, 'sidecar') if xml else (pm, 'photometa') if pm else (jpg, 'jpeg') if jpg else (None, '')
        if not chosen:
            why['unresolved: ' + ('gone from Google, not on store' if pano_id in gone else 'not asked/not on store')] += 1
            continue
        tile = (s.get('xml_tile_w') or (m or {}).get('tile_width') or 512, s.get('xml_tile_h') or (m or {}).get('tile_height') or 512)
        out.append({'pano_id': pano_id, 'width': chosen[0], 'height': chosen[1], 'tile_width': tile[0],
                    'tile_height': tile[1], 'source': src})
        why[src] += 1

    with open(args.out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['pano_id', 'width', 'height', 'tile_width', 'tile_height', 'source'])
        w.writeheader(); w.writerows(out)
    print(f'{len(out)} of {len(wanted)} labelled panos resolved -> {args.out}')
    for k, v in why.most_common(): print(f'  {v:>7}  {k}')
    print('sizes:', Counter((r['width'], r['height']) for r in out).most_common())
    overlap = [p for p in wanted if store.get(p, {}).get('jpeg_w') and p in meta]
    agree = sum(dims(store[p], 'jpeg_w', 'jpeg_h') == dims(meta[p], 'width', 'height') for p in overlap)
    print(f'jpeg header vs photometa on alive panos: {agree}/{len(overlap)} agree')
    if conflicts:
        print(f'{len(conflicts)} conflicts:')
        for c in conflicts[:40]: print('  ', *c)


if __name__ == '__main__':
    main()
