import csv
import gzip
import json
import lzma
import re
import shutil
import sys
from pathlib import Path
from collections import defaultdict


def strip_brackets(s: str) -> str:
    """Remove everything in [...] from the string, then strip whitespace."""
    return re.sub(r"\[[^\]]*\]", "", s).strip()

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
CSV_XZ = DATA_DIR / "imicroseq.csv.xz"
DATE_COL = "sample collection start date"

# Single JSON file: 8 levels of keys, leaf = list of measurement values (0-based index in output)
NEST_ORDER = [
    "geo loc name (state/province/territory)",
    "geo loc name (city)",
    "geo loc name (site)",
    "assay type",
    "target taxonomic name",
    "gene symbol",
    "diagnostic measurement unit",
    "sample collection start date",
]
VALUE_COL = "diagnostic measurement value"

METADATA_COLUMNS = [
    "sample collection start date",
    "geo loc name (site)",
    "geo loc name (state/province/territory)",
    "geo loc name (city)",
    "organism",
    "assay type",
]

# All target columns (for filtering empty rows)
TARGET_BASE_NAMES = [
    "target taxonomic name",
    "assay target name",
    "gene symbol",
    "diagnostic target presence",
    "diagnostic measurement value",
    "diagnostic measurement unit",
    "diagnostic measurement method",
]

def main() -> None:
    if not CSV_XZ.exists():
        print(f"Error: {CSV_XZ} not found", file=sys.stderr)
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with lzma.open(CSV_XZ, mode="rt", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        meta_ok = [c for c in METADATA_COLUMNS if c in fieldnames]
        meta_missing = [c for c in METADATA_COLUMNS if c not in fieldnames]
        if meta_missing:
            print(f"Note: metadata columns not in CSV (skipped): {meta_missing}", file=sys.stderr)
        rows = list(reader)

    out_rows: list[dict[str, str]] = []
    for row in rows:
        for target_num in (1, 2, 3):
            out_row: dict[str, str] = {}
            for col in meta_ok:
                out_row[col] = (row.get(col) or "").strip()
            out_row["target"] = str(target_num)
            for base in TARGET_BASE_NAMES:
                col_name = f"{base} {target_num}"
                out_row[base] = (row.get(col_name) or "").strip()
            out_rows.append(out_row)

    # Drop rows with no target information (all target fields empty)
    def has_target_info(r: dict[str, str]) -> bool:
        return any((r.get(base) or "").strip() for base in TARGET_BASE_NAMES)

    out_rows = [r for r in out_rows if has_target_info(r)]

    # Sort by sample collection start date (empty/missing last)
    def sort_key(r: dict[str, str]) -> tuple[bool, str]:
        d = (r.get(DATE_COL) or "").strip()
        return (not bool(d), d)

    out_rows.sort(key=sort_key)

    # Build single nested structure: 8 levels, leaf = list of measurement values
    # 8 levels of defaultdict, innermost is defaultdict(list)
    def _level8():
        return defaultdict(list)

    def _level7():
        return defaultdict(_level8)

    def _level6():
        return defaultdict(_level7)

    def _level5():
        return defaultdict(_level6)

    def _level4():
        return defaultdict(_level5)

    def _level3():
        return defaultdict(_level4)

    def _level2():
        return defaultdict(_level3)

    nested: dict = defaultdict(_level2)

    for r in out_rows:
        path_vals = []
        for f in NEST_ORDER:
            raw = (r.get(f) or "").strip()
            if f == DATE_COL:
                path_vals.append(strip_brackets(raw) or "(no date)")
            else:
                path_vals.append(strip_brackets(raw) or "(blank)")
        value_val = strip_brackets((r.get(VALUE_COL) or "").strip()) or "(blank)"
        d = nested
        for level_key in path_vals[:-1]:
            d = d[level_key]
        d[path_vals[-1]].append(value_val)

    def _sort_key(item):
        k = item[0]
        return (k in ("(no date)", "(blank)"), k)

    def to_sorted_dict(obj):
        if isinstance(obj, list):
            return {i: obj[i] for i in range(len(obj))}
        if isinstance(obj, dict):
            return dict(
                sorted(
                    ((k, to_sorted_dict(v)) for k, v in obj.items()),
                    key=_sort_key,
                )
            )
        return obj

    out_data = to_sorted_dict(nested)
    out_path = DATA_DIR / "viralLoadData.json.gz"
    json_bytes = json.dumps(out_data, ensure_ascii=False).encode("utf-8")
    with gzip.open(out_path, "wb", compresslevel=6) as f:
        f.write(json_bytes)
    print(f"Wrote {out_path} ({len(out_rows)} rows)")

    # Copy to public/data/ so the dashboard can fetch it as data/viralLoadData.json.gz
    public_quant = REPO_ROOT / "public" / "data" / "viralLoadData.json.gz"
    public_quant.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(out_path, public_quant)
    print(f"Copied to {public_quant}")


if __name__ == "__main__":
    main()
