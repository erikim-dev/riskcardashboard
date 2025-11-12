#!/usr/bin/env python3
"""
Simple CSV -> JSON updater for risk-data.json.
CSV format: path,value
- path: dot-separated JSON path, e.g. controlDetails.engine-control.outcome
- value: text value. Use numeric values for numbers (no %), or include % as part of the string.
- For list values, you can provide semicolon-separated items and the script will split them when the path ends with '.items' or when value contains ';'.

Usage:
  python data/update_from_csv.py data/update_template.csv

This will update data/risk-data.json in-place (backup created as risk-data.json.bak).
"""
import sys
import json
import re
from pathlib import Path
import csv
import shutil
import argparse

DATA_JSON = Path(__file__).resolve().parent / 'risk-data.json'


def parse_value(s: str):
    s = s.strip()
    if s == '':
        return ''
    # booleans/null
    if s.lower() in ('null', 'none'):
        return None
    if s.lower() in ('true', 'false'):
        return s.lower() == 'true'
    # integer
    try:
        if s.isdigit() or (s.startswith('-') and s[1:].isdigit()):
            return int(s)
        f = float(s)
        return f
    except Exception:
        pass
    # list split by ; if present
    if ';' in s:
        parts = [p.strip() for p in s.split(';') if p.strip()]
        return parts
    return s


def parse_path(path: str):
    """
    Parse a path like "a.b[0].c" into tokens: ['a', 'b', 0, 'c']
    Supports dot-separated names and numeric bracket indices. Does not support quoted keys.
    """
    tokens = []
    # regex finds either name segments or numeric indices in brackets
    token_re = re.compile(r"([^.\[\]]+)|\[(\d+)\]")
    for m in token_re.finditer(path):
        name, idx = m.groups()
        if name is not None:
            tokens.append(name)
        else:
            tokens.append(int(idx))
    return tokens


def set_in_data(obj, tokens, value):
    """
    Walk/create the structure in obj according to tokens and set the final value.
    tokens is a list where elements are either str (dict keys) or int (list indices).
    This will create dicts or lists as needed.
    """
    cur = obj
    for i, tok in enumerate(tokens):
        last = (i == len(tokens) - 1)
        if isinstance(tok, int):
            # we need a list here
            if not isinstance(cur, list):
                # if current is missing or wrong type, replace with list
                # but if it's an empty dict, prefer converting to list
                cur_parent_ref = None
                # Can't easily replace parent from here, assume caller passed top-level mutable object
                # Instead, for dict keys we create list values on the dict at previous token
                raise TypeError(f"Unexpected index access on non-list at token {tok} (path token index {i})")
            # ensure list is big enough
            idx = tok
            while len(cur) <= idx:
                cur.append(None)
            if last:
                cur[idx] = value
                return
            if cur[idx] is None:
                # decide next container type based on next token
                nxt = tokens[i + 1]
                cur[idx] = {} if isinstance(nxt, str) else []
            cur = cur[idx]
        else:
            # tok is a string key
            key = tok
            if last:
                # final assignment
                if isinstance(cur, list):
                    raise TypeError(f"Attempting to set key '{key}' on a list (bad path).")
                cur[key] = value
                return
            # ensure container exists
            if isinstance(cur, list):
                raise TypeError(f"Attempting to traverse key '{key}' on a list (bad path).")
            if key not in cur or cur[key] is None:
                # create next container depending on next token
                nxt = tokens[i + 1]
                cur[key] = {} if isinstance(nxt, str) else []
            cur = cur[key]


def main(csv_path: str):
    csvf = Path(csv_path)
    if not csvf.exists():
        print(f"CSV file not found: {csv_path}")
        return 2
    if not DATA_JSON.exists():
        print(f"Data JSON not found: {DATA_JSON}")
        return 2

    with DATA_JSON.open('r', encoding='utf-8') as f:
        data = json.load(f)

    backup = DATA_JSON.with_suffix('.json.bak')
    shutil.copy2(DATA_JSON, backup)
    print(f"Backup written to {backup}")

    updated = False
    with csvf.open(newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        headers = next(reader, None)
        # Accept either header row 'path,value' or treat first row as data if header missing
        has_header = headers and len(headers) >= 2 and headers[0].strip().lower() == 'path'
        if not has_header:
            # treat first row as data
            f.seek(0)
            reader = csv.reader(f)
        for row in reader:
            if not row or len(row) < 2:
                continue
            path = row[0].strip()
            raw = ','.join(row[1:]).strip()
            if not path:
                continue
            val = parse_value(raw)
            # special-case: when the target is an '.items' list and we have a string, split on ; or |
            if isinstance(val, str) and (path.endswith('.items') or (';' in val) or ('|' in val)):
                if ';' in val:
                    val = [p.strip() for p in val.split(';') if p.strip()]
                elif '|' in val:
                    val = [p.strip() for p in val.split('|') if p.strip()]
            try:
                tokens = parse_path(path)
            except Exception as e:
                print(f"Failed to parse path '{path}': {e}")
                continue
            # allow implicit splitting into lists when ; or | present
            if isinstance(val, str) and (';' in val or '|' in val):
                if ';' in val:
                    val = [p.strip() for p in val.split(';') if p.strip()]
                else:
                    val = [p.strip() for p in val.split('|') if p.strip()]
            try:
                # Perform nested set (creates containers as needed)
                set_in_data(data, tokens, val)
                print(f"Set {path} => {val}")
                updated = True
            except Exception as e:
                print(f"Failed to set {path}: {e}")

    if updated:
        with DATA_JSON.open('w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Updated {DATA_JSON}")
    else:
        print("No updates applied.")
    return 0


def flatten_json(obj, prefix=''):
    """Yield (path, value) for each leaf in obj. Arrays use [i] notation."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            yield from flatten_json(v, key)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            key = f"{prefix}[{i}]"
            yield from flatten_json(v, key)
    else:
        # primitive
        # For lists that were leaf values we represent as semicolon-separated when originally list
        yield prefix, obj


def export_template(out_csv_path: str):
    DATA_JSON = Path(__file__).resolve().parent / 'risk-data.json'
    if not DATA_JSON.exists():
        print(f"Data JSON not found: {DATA_JSON}")
        return 2
    with DATA_JSON.open('r', encoding='utf-8') as f:
        data = json.load(f)

    # Limit exported template to editable prefixes
    ALLOWED_PREFIXES = [
        'issuesOpenValue', 'netLossValue', 'MTD Risk Events', 'ytdRiskEvents',
        'appetiteConsumption', 'noOfMaterialIssues', 'SRT', 'KRIs',
        'alerts', 'controlSystems', 'svgElementMappings', 'indicatorConditions',
        'stressSituations', 'controlDetails', 'rightPanel', 'metadata',
        'srtDetails', 'gaugeSrtDetails'
    ]

    def is_editable_path(p: str) -> bool:
        if p == 'metadata.lastUpdated':
            return True
        for pref in ALLOWED_PREFIXES:
            if p == pref:
                return True
            if p.startswith(pref + '.') or p.startswith(pref + '[') or p.startswith(pref + '/'):
                return True
        return False

    rows = []
    for path, val in flatten_json(data):
        if not is_editable_path(path):
            continue
        # For list-type leaves (if val is list), join by ;
        if isinstance(val, list):
            v = ';'.join(str(x) for x in val)
        else:
            v = str(val) if val is not None else ''
        rows.append((path, v))

    outp = Path(out_csv_path)
    with outp.open('w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['path', 'value'])
        for r in rows:
            writer.writerow(r)
    print(f"Exported template to {outp}")
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='CSV <-> JSON updater for risk-data.json')
    parser.add_argument('--export-template', '-e', dest='export', help='Write a CSV template of all JSON fields to this path')
    parser.add_argument('csv', nargs='?', help='CSV file with updates (path,value) to apply')
    args = parser.parse_args()

    if args.export:
        sys.exit(export_template(args.export))
    if args.csv:
        sys.exit(main(args.csv))
    parser.print_help()
    sys.exit(2)
