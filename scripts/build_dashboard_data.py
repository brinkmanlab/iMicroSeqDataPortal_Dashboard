#!/usr/bin/env python3
"""
Build dashboard data from imicroseq.csv.xz for static serving.

Reads the full dataset from data/imicroseq.csv.xz (XZ-compressed CSV with same
headers as imicroseq.tsv), applies the same aggregation logic as the
Cloudflare Worker, and writes:

  - data/data.json        : full dashboard API payload
  - data/data.tsv         : sampleFieldSpecRows as TSV (Explore chart table)
  - public/data/portalData.json.gz : same payload gzip-compressed for Worker assets

Run from repo root:
  python scripts/build_dashboard_data.py

The Worker serves /api/dashboard from public/data/portalData.json.gz when present;
otherwise it falls back to loading from GitHub.
"""

import csv
import gzip
import json
import lzma
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
PUBLIC_DATA_DIR = REPO_ROOT / "public" / "data"
CSV_XZ = DATA_DIR / "imicroseq.csv.xz"
PROVINCE_COORDS_CSV = DATA_DIR / "ProvinceCapitalCoords.csv"
OUTPUT_JSON = DATA_DIR / "data.json"
OUTPUT_TSV = DATA_DIR / "data.tsv"
OUTPUT_JSON_GZ_PUBLIC = PUBLIC_DATA_DIR / "portalData.json.gz"


def trim_brackets(s: str | None) -> str:
    """Remove everything in [], including the brackets, from the value."""
    if s is None:
        return ""
    out = (s or "").strip()
    while "[" in out:
        out = re.sub(r"\[[^\]]*\]", "", out)
    return out.strip()


def parse_lat_lon(raw: str | None, kind: str) -> float | None:
    if raw is None:
        return None
    s = (raw or "").strip()
    if not s or s == "--" or "not provided" in s.lower():
        return None
    m = re.match(r"(-?\d+(?:\.\d+)?)\s*([NSEW])?", s, re.I)
    if not m:
        return None
    try:
        value = float(m.group(1))
    except ValueError:
        return None
    hemi = (m.group(2) or "").upper()
    if hemi in ("S", "W"):
        value = -abs(value)
    elif hemi in ("N", "E"):
        value = abs(value)
    if kind == "lat" and (value < -90 or value > 90):
        return None
    if kind == "lon" and (value < -180 or value > 180):
        return None
    return value


def load_province_coords() -> dict[str, tuple[float, float]]:
    coords: dict[str, tuple[float, float]] = {}
    if not PROVINCE_COORDS_CSV.exists():
        return coords
    with open(PROVINCE_COORDS_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("Province") or "").strip()
            if not name:
                continue
            try:
                lat = float(row.get("Latitude", 0))
                lon = float(row.get("Longitude", 0))
            except (TypeError, ValueError):
                continue
            coords[name] = (lat, lon)
            short = name.split(" [")[0].strip()
            if short and short != name:
                coords[short] = (lat, lon)
    return coords


def main() -> None:
    if not CSV_XZ.exists():
        print(f"Error: {CSV_XZ} not found", file=sys.stderr)
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    province_coords = load_province_coords()

    with lzma.open(CSV_XZ, mode="rt", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    total_records = len(rows)
    site_set: set[str] = set()
    org_set: set[str] = set()
    organisms_set: set[str] = set()
    coord_counts: dict[str, int] = {}
    growth_by_year: dict[int, int] = {}
    min_year: float = float("inf")
    max_year: float = float("-inf")

    for row in rows:
        site = (row.get("geo loc name (site)") or "").strip()
        if site:
            site_set.add(site)
        org = (row.get("sample collected by organisation name") or "").strip()
        if org:
            org_set.add(org)
        organism = (row.get("organism") or "").strip()
        if organism:
            organisms_set.add(organism)

        lat = parse_lat_lon(row.get("geo loc latitude"), "lat")
        lon = parse_lat_lon(row.get("geo loc longitude"), "lon")
        if lon != None and lon > 0:
            print("hello")
        if lat is None or lon is None:
            state_province = (
                row.get("geo loc name (state/province/territory)") or ""
            ).strip()
            fallback = province_coords.get(state_province) if state_province else None
            if fallback:
                lat, lon = fallback
        if lat is not None and lon is not None:
            key = f"{lat},{lon}"
            coord_counts[key] = coord_counts.get(key, 0) + 1

        date_str = (row.get("sample collection start date") or "").strip()
        if date_str:
            ym = re.match(r"^(\d{4})", date_str)
            if ym:
                try:
                    year = int(ym.group(1))
                    min_year = min(min_year, year)
                    max_year = max(max_year, year)
                    growth_by_year[year] = growth_by_year.get(year, 0) + 1
                except ValueError:
                    pass

    cumulative = 0
    y_min = int(min_year) if min_year != float("inf") else 0
    y_max = int(max_year) if max_year != float("-inf") else 0
    growth: list[dict[str, int]] = []
    for y in range(y_min, y_max + 1):
        count = growth_by_year.get(y, 0)
        cumulative += count
        growth.append({"year": y, "records": cumulative})

    site_counts: dict[str, int] = {}
    for row in rows:
        site = trim_brackets(row.get("environmental site")) or "Unknown"
        site_counts[site] = site_counts.get(site, 0) + 1
    top_sites = [
        name for name, _ in sorted(site_counts.items(), key=lambda x: -x[1])[:8]
    ]
    category_counts: dict[str, int] = {}
    for row in rows:
        site = trim_brackets(row.get("environmental site")) or "Unknown"
        cat = site if site in top_sites else "Other"
        category_counts[cat] = category_counts.get(cat, 0) + 1
    # Descending by value, "Other" last
    breakdown = [
        {"category": k, "value": v}
        for k, v in sorted(
            category_counts.items(),
            key=lambda x: (x[0].lower() == "other", -x[1]),
        )
    ]

    coverage_points = []
    for key, count in coord_counts.items():
        lat_s, lon_s = key.split(",", 1)
        coverage_points.append(
            {"latitude": float(lat_s), "longitude": float(lon_s), "count": count}
        )
    coverage_points.sort(key=lambda x: -x["count"])

    sample_field_spec_rows: list[dict] = []
    for row in rows:
        date_str = (row.get("sample collection start date") or "").strip()
        year = None
        year_month = None
        if date_str:
            ym = re.match(r"^(\d{4})", date_str)
            if ym:
                try:
                    year = int(ym.group(1))
                except ValueError:
                    pass
            ymm = re.match(r"^(\d{4})-(\d{2})", date_str)
            if ymm:
                year_month = f"{ymm.group(1)}-{ymm.group(2)}"
        sample_field_spec_rows.append(
            {
                "organism": trim_brackets(row.get("organism", "")),
                "purpose of sampling": trim_brackets(row.get("purpose of sampling", "")),
                "geo loc name (state/province/territory)": trim_brackets(
                    row.get("geo loc name (state/province/territory)", "")
                ),
                "environmental site": trim_brackets(row.get("environmental site", "")),
                "collection device": trim_brackets(row.get("collection device", "")),
                "assay type": trim_brackets(row.get("assay type", "")),
                "Year": year,
                "Year-Month": year_month,
            }
        )

    payload = {
        "summary": {
            "records": total_records,
            "sites": len(site_set),
            "timeSpan": {
                "start": int(min_year) if min_year != float("inf") else None,
                "end": int(max_year) if max_year != float("-inf") else None,
            },
            "organisms": len(organisms_set),
            "dataSources": len(org_set),
        },
        "growth": growth,
        "breakdown": breakdown,
        "coveragePoints": coverage_points,
        "fields": ["All Records"],
        "sampleFieldSpecRows": sample_field_spec_rows,
        "axisOptions": [
            {"value": "organism", "label": "organism"},
            {"value": "purpose of sampling", "label": "purpose of sampling"},
            {
                "value": "geo loc name (state/province/territory)",
                "label": "geo loc name (state/province/territory)",
            },
            {"value": "environmental site", "label": "environmental site"},
            {"value": "collection device", "label": "collection device"},
            {"value": "assay type", "label": "assay type"},
            {"value": "Year", "label": "Year"},
            {"value": "Year-Month", "label": "Year-Month"},
        ],
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    json_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    with gzip.open(OUTPUT_JSON_GZ_PUBLIC, "wb", compresslevel=6) as f:
        f.write(json_bytes)

    # if sample_field_spec_rows:
    #     sample_keys = list(sample_field_spec_rows[0].keys())
    #     with open(OUTPUT_TSV, "w", newline="", encoding="utf-8") as f:
    #         w = csv.DictWriter(f, fieldnames=sample_keys, delimiter="\t")
    #         w.writeheader()
    #         for r in sample_field_spec_rows:
    #             w.writerow({k: ("" if v is None else v) for k, v in r.items()})

    print(f"Wrote {OUTPUT_JSON} ({total_records} records)")
    # print(f"Wrote {OUTPUT_TSV}")
    print(f"Wrote {OUTPUT_JSON_GZ_PUBLIC} (gzip for Worker assets)")


if __name__ == "__main__":
    main()
