#!/usr/bin/env python3
"""#5667: what the pano store knows about every DC pano. Read-only, stdlib only, header reads only (a few KB per
JPEG). SAFE TO RUN ON THE SCRAPER BOX; it writes nothing into the store.

    python3 5667-dc-store-dims.py <store>/dc [<store>/washington-dc ...] --out 5667-dc-store.csv --workers 8

One row per pano found in any of the folders given:
  pano_id, folder, jpeg_w, jpeg_h, xml_w, xml_h, xml_tile_w, xml_tile_h, xml_lat, xml_lng, xml_orig_lat,
  xml_orig_lng, xml_yaw, xml_date, has_depth, log_downloaded
`xml_*` come from the cbk sidecar `<pano_id>.xml` when it exists (Google's own metadata at scrape time; width/height
there are the label frame by definition). `jpeg_*` are the stored file's dimensions. `log_downloaded` is the folder's
pano_id_log.csv verdict, so "never scraped" and "attempted, failed" can be told apart for panos with no file.
"""
import argparse, csv, os, struct, sys
from concurrent.futures import ThreadPoolExecutor
from xml.etree import ElementTree

COLS = ['pano_id', 'folder', 'jpeg_w', 'jpeg_h', 'xml_w', 'xml_h', 'xml_tile_w', 'xml_tile_h', 'xml_lat', 'xml_lng',
        'xml_orig_lat', 'xml_orig_lng', 'xml_yaw', 'xml_date', 'has_depth', 'log_downloaded']


def jpeg_size(path):
    """(width, height) from a JPEG's first SOF marker, or None."""
    try:
        with open(path, 'rb') as f:
            if f.read(2) != b'\xff\xd8':
                return None
            while True:
                byte = f.read(1)
                while byte == b'\xff':
                    byte = f.read(1)
                if not byte:
                    return None
                marker = byte[0]
                length_bytes = f.read(2)
                if len(length_bytes) < 2:
                    return None
                length = struct.unpack('>H', length_bytes)[0]
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    payload = f.read(7)
                    if len(payload) < 5:
                        return None
                    height, width = struct.unpack('>HH', payload[1:5])
                    return width, height
                f.seek(length - 2, os.SEEK_CUR)
                if f.read(1) != b'\xff':
                    return None
                f.seek(-1, os.SEEK_CUR)
    except OSError:
        return None


def parse_sidecar(path):
    """The data_properties/projection_properties attributes of a cbk XML sidecar, or {}."""
    try:
        root = ElementTree.parse(path).getroot()
    except (ElementTree.ParseError, OSError):
        return {}
    out = {}
    for child in root:
        if child.tag in ('data_properties', 'projection_properties'):
            out.update(child.attrib)
    return out


def load_log(folder):
    """pano_id -> downloaded flag from the folder's pano_id_log.csv, or {}."""
    path = os.path.join(folder, 'pano_id_log.csv')
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, newline='') as f:
            return {r['pano_id']: r.get('downloaded', '') for r in csv.DictReader(f) if r.get('pano_id')}
    except (OSError, csv.Error):
        return {}


def scan_folder(folder):
    """Every pano id with a .jpg or .xml under <folder>/<2 chars>/, as (pano_id, folder, base_path)."""
    found = {}
    for shard in sorted(os.listdir(folder)):
        shard_dir = os.path.join(folder, shard)
        if len(shard) != 2 or not os.path.isdir(shard_dir):
            continue
        for name in os.listdir(shard_dir):
            stem, ext = os.path.splitext(name)
            # Display copies (<id>.w8192.jpg) and other derivatives carry a dot in the stem; a pano id never does.
            if ext in ('.jpg', '.xml') and '.' not in stem and stem[:2] == shard:
                found[stem] = os.path.join(shard_dir, stem)
    return [(pano_id, folder, base) for pano_id, base in found.items()]


def probe(item):
    pano_id, folder, base = item
    row = {c: '' for c in COLS}
    row.update(pano_id=pano_id, folder=os.path.basename(folder.rstrip('/')))
    jpg = base + '.jpg'
    if os.path.isfile(jpg):
        size = jpeg_size(jpg)
        if size:
            row['jpeg_w'], row['jpeg_h'] = size
    if os.path.isfile(base + '.xml'):
        x = parse_sidecar(base + '.xml')
        row.update(xml_w=x.get('image_width', ''), xml_h=x.get('image_height', ''), xml_tile_w=x.get('tile_width', ''),
                   xml_tile_h=x.get('tile_height', ''), xml_lat=x.get('lat', ''), xml_lng=x.get('lng', ''),
                   xml_orig_lat=x.get('original_lat', ''), xml_orig_lng=x.get('original_lng', ''),
                   xml_yaw=x.get('pano_yaw_deg', ''), xml_date=x.get('image_date', ''))
    row['has_depth'] = int(os.path.isfile(base + '.depth.npz'))
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folders', nargs='+')
    ap.add_argument('--out', default='5667-dc-store.csv')
    ap.add_argument('--workers', type=int, default=8)
    args = ap.parse_args()

    items, logs = [], {}
    for folder in args.folders:
        if not os.path.isdir(folder):
            print(f'skipping {folder}: not a directory', file=sys.stderr)
            continue
        items += scan_folder(folder)
        logs[folder] = load_log(folder)
    print(f'{len(items)} panos across {len(args.folders)} folder(s)', file=sys.stderr)

    with ThreadPoolExecutor(args.workers) as pool:
        rows = list(pool.map(probe, items))
    for (pano_id, folder, _), row in zip(items, rows):
        row['log_downloaded'] = logs[folder].get(pano_id, '')
    for folder, log in logs.items():  # panos the ledger knows but no file exists for
        seen = {r['pano_id'] for r in rows}
        for pano_id, downloaded in log.items():
            if pano_id not in seen:
                row = {c: '' for c in COLS}
                row.update(pano_id=pano_id, folder=os.path.basename(folder.rstrip('/')), log_downloaded=downloaded)
                rows.append(row)

    with open(args.out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)

    with_jpg = [r for r in rows if r['jpeg_w']]
    with_xml = [r for r in rows if r['xml_w']]
    both = [r for r in with_jpg if r['xml_w']]
    agree = sum(1 for r in both if (str(r['jpeg_w']), str(r['jpeg_h'])) == (r['xml_w'], r['xml_h']))
    print(f'rows {len(rows)}: jpg {len(with_jpg)}, xml {len(with_xml)}, both {len(both)}, '
          f'jpg==xml on {agree}/{len(both)}; ledger-only {len(rows) - len(items)}', file=sys.stderr)
    from collections import Counter
    print('jpg sizes:', Counter((r['jpeg_w'], r['jpeg_h']) for r in with_jpg).most_common(8), file=sys.stderr)


if __name__ == '__main__':
    main()
