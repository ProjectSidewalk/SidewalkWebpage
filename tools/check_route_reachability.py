#!/usr/bin/env python3
"""
Route-reachability lint for conf/routes: fail if any route is UNREACHABLE ("shadowed").

Play matches routes top-to-bottom and commits to the first route whose PATH pattern matches: if a typed path
parameter then fails to bind it returns 400, it does NOT fall through to a later route. So a route whose every request
path is already matched by an earlier same-method route is dead -- and if that earlier route has a typed param that the
later route's literal segment can't satisfy (e.g. `GET /label/:labelId` above `GET /label/tags`), requests to it 400
instead of reaching the intended handler. That is exactly the #456 regression this guard exists to prevent; see the
companion faithful check in test/controllers/RouteReachabilitySpec.scala (which reads the compiled Router.documentation).

This is a fast, deterministic, DB-free static check (like db/scripts/lint-evolutions.sh and tools/check-locale-parity.mjs)
so it can gate every PR without booting the app. Exit code 0 = all routes reachable; 1 = one or more shadowed.

Detection: for each route B, generate a couple of diverse concrete example paths from B's own pattern, then flag B if
some EARLIER same-method route A matches ALL of them (A already claims every request B could receive). Two diverse
samples defeat the subset-regex false positive where an earlier route is stricter than B on the same shape.
"""
import re
import sys
from pathlib import Path

METHODS = {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"}
# Concrete tokens for sampling each dynamic segment. A rest-of-path segment (*name -> .+) accepts a token
# containing "/", so "a/b" leads the list: it forces wildcard routes to be sampled with a genuine MULTI-segment path,
# which correctly distinguishes /assets/*file from an earlier single-segment sibling (/assets/:x, i.e. [^/]+) that it
# out-covers. A normal :name (-> [^/]+) segment rejects the slash, so "a/b" filters out for those and the two-sample
# cap (toks[:2]) yields a diverse numeric/alpha pair. The remaining tokens are deliberately diverse (numeric vs alpha)
# so two samples defeat the subset-regex false positive where an earlier route is stricter on the same shape (e.g. an
# earlier :id<[0-9]+> over a plain :id).
SAMPLE_POOL = ["a/b", "1", "zqx", "abc123", "12", "a-b_c"]


def parse_routes(path):
    """(method, path, handler) for each declared route, in declaration (match-priority) order."""
    routes = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("+") or line.startswith("->"):
            continue  # comments, route modifiers (+ nocsrf), and sub-router includes
        parts = line.split(None, 2)
        if len(parts) < 2 or parts[0] not in METHODS:
            continue
        routes.append((parts[0], parts[1], parts[2] if len(parts) > 2 else ""))
    return routes


def _seg_regex(seg):
    """Regex source for one path segment (no surrounding slashes)."""
    m = re.fullmatch(r":([^<]+)<(.+)>", seg)  # :name<regex>
    if m:
        return m.group(2)
    if seg.startswith(":"):                   # :name -> one path segment
        return r"[^/]+"
    if seg.startswith("*"):                   # *name -> rest of path (may contain /)
        return r".+"
    return re.escape(seg)                     # literal


def path_to_regex(p):
    return re.compile("^" + "/".join(_seg_regex(s) for s in p.split("/")) + "$")


def _seg_samples(seg):
    """Up to two concrete tokens the segment accepts, or None if its regex is unsampleable."""
    if seg.startswith(":") or seg.startswith("*"):
        rx = _seg_regex(seg)
        toks = [t for t in SAMPLE_POOL if re.fullmatch(rx, t)]
        return toks[:2] if toks else None
    return [seg]


def path_samples(p):
    """A couple of concrete example paths this route accepts, or None if any segment is unsampleable."""
    per_seg = [_seg_samples(s) for s in p.split("/")]
    if any(s is None for s in per_seg):
        return None
    k = max(len(s) for s in per_seg)
    samples = ["/".join(s[i] if i < len(s) else s[0] for s in per_seg) for i in range(min(k, 2))]
    return list(dict.fromkeys(samples))


def find_shadowed(routes):
    compiled = [(m, p, h, path_to_regex(p)) for (m, p, h) in routes]
    violations, skipped = [], []
    for j, (mj, pj, hj, _) in enumerate(compiled):
        samples = path_samples(pj)
        if samples is None:
            skipped.append(f"{mj} {pj}")
            continue
        for mi, pi, hi, rxi in compiled[:j]:
            if mi == mj and all(rxi.match(s) for s in samples):
                violations.append((mj, pj, hj, mi, pi, hi))
                break
    return violations, skipped


def main():
    routes_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "conf" / "routes"
    routes = parse_routes(routes_path)
    violations, skipped = find_shadowed(routes)

    for note in (f"note: could not sample (skipped): {s}" for s in skipped):
        print(note, file=sys.stderr)

    if violations:
        print(f"✗ route reachability: {len(violations)} unreachable route(s) in {routes_path}\n", file=sys.stderr)
        for mj, pj, hj, mi, pi, hi in violations:
            print(f"  {mj} {pj} -> {hj}", file=sys.stderr)
            print(f"      is shadowed by earlier  {mi} {pi} -> {hi}", file=sys.stderr)
        print(
            "\nPlay matches routes top-to-bottom and 400s on a typed-param mismatch instead of falling through, so the "
            "shadowed route is unreachable. Move the more specific route ABOVE the broader one in conf/routes.",
            file=sys.stderr,
        )
        return 1

    print(f"✓ route reachability: all {len(routes)} routes reachable (none shadowed by an earlier same-method route)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
