#!/usr/bin/env python3
"""#5667: one dimension per DC pano from the store's sidecars and photometa, with provenance and a conflict report.

    python3 5667-join-dims.py --panos dc-labelled-panos.csv --store 5667-dc-store.csv \
        --photometa dc-sweep/chunk-*.csv --out 5667-dc-dims.csv

Precedence: cbk sidecar (Google's metadata at scrape time) > photometa (what Google serves now). A pano never
changes size, so the two must agree wherever they overlap; a disagreement is listed and the pano left unresolved.
The stored JPEG's header is reported against them but never used as a size on its own: the old scraper stitched
2007-08 panos at four times their real size, so a JPEG-only pano stays unresolved.
`--panos` is the list of labelled DC pano ids (one `pano_id` column), so coverage is reported against what matters.
"""
import argparse, csv, glob, sys
from collections import Counter

COLS = ['pano_id', 'width', 'height', 'tile_width', 'tile_height', 'source']


def read(paths):
    rows = []
    for p in paths:
        with open(p, newline='') as f:
            rows += list(csv.DictReader(f))
    return rows


def dims(r, w, h):
    return (int(r[w]), int(r[h])) if r and r.get(w) and r.get(h) else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panos', required=True)
    ap.add_argument('--store', required=True)
    ap.add_argument('--photometa', nargs='+', required=True)
    ap.add_argument('--out', default='5667-dc-dims.csv')
    args = ap.parse_args()

    wanted = [r['pano_id'] for r in read([args.panos])]
    store = {}
    for r in read([args.store]):  # one row per (pano, folder); two folders must not disagree about a pano
        prev = store.setdefault(r['pano_id'], r)
        if prev is not r and (dims(prev, 'xml_w', 'xml_h'), dims(prev, 'jpeg_w', 'jpeg_h')) != \
                (dims(r, 'xml_w', 'xml_h'), dims(r, 'jpeg_w', 'jpeg_h')):
            sys.exit(f"{r['pano_id']} appears in {prev['folder']} and {r['folder']} with different sizes")
    photometa = read(sum((glob.glob(p) for p in args.photometa), []))
    meta = {r['pano_id']: r for r in photometa if r.get('status') == 'OK'}
    gone = {r['pano_id'] for r in photometa if r.get('status') == 'NOT_FOUND'}

    out, conflicts, why = [], [], Counter()
    for pano_id in wanted:
        s, m = store.get(pano_id), meta.get(pano_id)
        xml, pm, jpg = dims(s, 'xml_w', 'xml_h'), dims(m, 'width', 'height'), dims(s, 'jpeg_w', 'jpeg_h')
        if xml and pm and xml != pm:
            conflicts.append((pano_id, 'sidecar vs photometa', xml, pm)); why['conflict'] += 1; continue
        chosen, src = (xml, 'sidecar') if xml else (pm, 'photometa') if pm else (None, '')
        if not chosen:
            why['unresolved: ' + ('gone from Google, not on store' if pano_id in gone else 'not asked')] += 1
            continue
        if jpg and jpg != chosen:
            conflicts.append((pano_id, 'stored jpeg vs ' + src, jpg, chosen))
        tile = (s['xml_tile_w'], s['xml_tile_h']) if src == 'sidecar' else (m['tile_width'], m['tile_height'])
        out.append(dict(zip(COLS, (pano_id, chosen[0], chosen[1], tile[0], tile[1], src))))
        why[src] += 1

    with open(args.out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(out)
    print(f'{len(out)} of {len(wanted)} labelled panos resolved -> {args.out}')
    for k, v in why.most_common():
        print(f'  {v:>7}  {k}')
    print('sizes:', Counter((r['width'], r['height']) for r in out).most_common())
    live = [p for p in wanted if dims(store.get(p), 'jpeg_w', 'jpeg_h') and p in meta]
    agree = sum(dims(store[p], 'jpeg_w', 'jpeg_h') == dims(meta[p], 'width', 'height') for p in live)
    print(f'stored jpeg vs photometa on live panos: {agree}/{len(live)} agree')
    if conflicts:
        print(f'{len(conflicts)} disagreements (stored-jpeg ones are informational):')
        for c in conflicts[:40]:
            print('  ', *c)


if __name__ == '__main__':
    main()
