#!/usr/bin/env python3
"""Issue #4587, phase 5: fetch full pano metadata from Google Maps' internal photometa endpoint.

The official Street View metadata API returns only date/location/copyright, which is not enough to feed evolution
179's coordinate conversion -- that needs `width`, `height`, `camera_heading` and `camera_pitch`. The legacy `cbk`
endpoint that produced our scraped XML sidecars now 404s, so photometa is the only remaining source for those fields.
It is the same endpoint google.com/maps itself calls, and it refuses requests without browser-ish headers.

Response shape (indices verified against a known pano, 2026-08-21):
    pano[1][1]              pano id
    pano[2][2]              [height, width]
    pano[2][3][1]           [tile_height, tile_width]
    pano[3][2]              address lines
    pano[4][0][0][0][0]     copyright (stamped with the current year, not the capture year)
    pano[5][0][1][0][2:4]   lat, lng
    pano[5][0][1][2]        [heading, pitch, roll] in degrees, pitch measured from straight down
    pano[5][0][3][0]        neighbouring panos
    pano[6][7]              [year, month]

Usage:

    python3 scratchpad/4587-fetch-photometa.py -o scratchpad/photometa-results.csv \\
        --input scratchpad/gsv-metadata-check.csv --only-status OK
    python3 scratchpad/4587-fetch-photometa.py -o /dev/stdout --panos j6-uZGrtNJU24rm-j9yTZQ
"""

import argparse
import csv
import gzip
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

# The pb parameter is a positional protobuf-in-a-querystring; `!2s<pano_id>` selects lookup by id.
PHOTOMETA_URL = (
    "https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=us&pb="
    "!1m4!1smaps_sv.tactile!11m2!2m1!1b1!2m2!1sen!2sus!3m3!1m2!1e2!2s{pano_id}"
    "!4m57!1e1!1e2!1e3!1e4!1e5!1e6!1e8!1e12!2m1!1e1!4m1!1i48!5m1!1e1!5m1!1e2!6m1!1e1!6m1!1e2"
    "!9m36!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b1!3e2!1m3!1e3!2b0!3e3!1m3!1e8!2b0!3e3"
    "!1m3!1e1!2b0!3e3!1m3!1e4!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e3"
)
# Without a browser-ish header set Google answers with an empty record for some panos -- indistinguishable from a
# deleted one, so an incomplete set here quietly reads as data loss. urllib's default `Accept-Encoding: identity` is
# part of what trips it, hence gzip below.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36",
    "Referer": "https://www.google.com/maps/",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}
OUT_COLUMNS = [
    "city", "pano_id", "n_labels", "status", "width", "height", "tile_width", "tile_height", "lat", "lng",
    "heading", "raw_pitch", "roll", "capture_date", "address", "copyright", "n_links",
]


def at(value, *path):
    """Index into the nested response, returning None the moment the path runs out rather than raising."""
    for key in path:
        if value is None:
            return None
        try:
            value = value[key]
        except (IndexError, KeyError, TypeError):
            return None
    return value


def fetch(pano_id, timeout):
    """Returns (parsed_json, error_string). Google prefixes its response with an anti-JSON-hijack guard."""
    request = urllib.request.Request(PHOTOMETA_URL.format(pano_id=urllib.parse.quote(pano_id)), headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            elif response.headers.get("Content-Encoding") == "deflate":
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
            body = raw.decode("utf-8")
    except urllib.error.HTTPError as e:
        return None, "HTTP {}".format(e.code)
    except Exception as e:
        return None, type(e).__name__
    return json.loads(body[body.index("["):]), ""


def parse(payload):
    """Flatten a photometa response into pano_data-shaped fields. Empty dict when the pano no longer exists."""
    pano = at(payload, 1, 0)
    if at(pano, 2) is None:
        return {}

    size = at(pano, 2, 2) or []
    tile = at(pano, 2, 3, 1) or []
    position = at(pano, 5, 0, 1, 0) or []
    angles = at(pano, 5, 0, 1, 2) or []
    date = at(pano, 6, 7) or []
    address = [line[0] for line in (at(pano, 3, 2) or []) if line]

    return {
        "width": at(size, 1),
        "height": at(size, 0),
        "tile_width": at(tile, 1),
        "tile_height": at(tile, 0),
        "lat": at(position, 2),
        "lng": at(position, 3),
        "heading": at(angles, 0),
        "raw_pitch": at(angles, 1),
        "roll": at(angles, 2),
        "capture_date": "{:04d}-{:02d}".format(date[0], date[1]) if len(date) >= 2 else "",
        "address": ", ".join(address),
        "copyright": at(pano, 4, 0, 0, 0, 0),
        "n_links": len(at(pano, 5, 0, 3, 0) or []),
    }


def read_input(path, only_status):
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if only_status:
        rows = [row for row in rows if row.get("status", "") == only_status]
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--output", required=True, help="Where to write the results CSV")
    parser.add_argument("--input", help="CSV with a pano_id column (city/n_labels carried through when present)")
    parser.add_argument("--panos", nargs="+", default=[], help="Pano IDs to fetch instead of --input")
    parser.add_argument("--only-status", help="With --input, keep only rows whose status column equals this")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between requests")
    parser.add_argument("--retries", type=int, default=3, help="Attempts before calling a pano gone")
    parser.add_argument("--timeout", type=float, default=20.0, help="Per-request timeout in seconds")
    args = parser.parse_args()

    if args.input:
        panos = read_input(args.input, args.only_status)
    else:
        panos = [{"pano_id": pano_id} for pano_id in args.panos]
    if not panos:
        sys.exit("Nothing to fetch.")

    print("Fetching {} panos...".format(len(panos)), file=sys.stderr)
    rows, found = [], 0
    for i, pano in enumerate(panos, 1):
        # An empty record is how Google reports a deleted pano, but it also comes back intermittently for panos that
        # do exist, so treat it as a miss only after it repeats.
        for attempt in range(args.retries):
            payload, error = fetch(pano["pano_id"], args.timeout)
            fields = parse(payload) if payload else {}
            if fields:
                break
            if attempt < args.retries - 1:
                time.sleep(args.delay * (attempt + 2))
        status = error or ("OK" if fields else "NOT_FOUND")
        found += 1 if fields else 0
        row = {column: "" for column in OUT_COLUMNS}
        row.update({"city": pano.get("city", ""), "pano_id": pano["pano_id"], "n_labels": pano.get("n_labels", "")})
        row.update(fields)
        row["status"] = status
        rows.append(row)
        print("  [{}/{}] {:<16} {}  {}".format(i, len(panos), row["city"], pano["pano_id"], status), file=sys.stderr)
        if i < len(panos):
            time.sleep(args.delay)

    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print("\n{}/{} resolved. Wrote {}".format(found, len(rows), args.output), file=sys.stderr)


if __name__ == "__main__":
    main()
