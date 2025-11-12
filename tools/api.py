#!/usr/bin/env python3
"""Simple Flask API to read/update data/risk-data.json and export/import CSV templates.

Endpoints:
- GET  /api/data -> returns the current JSON
- POST /api/update -> accepts JSON body {updates:[{path,value},...]} or multipart/form-data with file 'file' (CSV)
- GET  /api/export-template -> returns CSV flattened from current JSON

Runs on 0.0.0.0:5000 by default.
"""
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import json
from pathlib import Path
import shutil
import csv
import io
import re

APP = Flask(__name__)
CORS(APP)
BASE = Path(__file__).resolve().parent.parent
DATA_JSON = BASE / 'data' / 'risk-data.json'


def parse_value(s: str):
    if s is None:
        return None
    s = str(s).strip()
    if s == '':
        return ''
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
    # list spliters
    if ';' in s:
        return [p.strip() for p in s.split(';') if p.strip()]
    if '|' in s:
        return [p.strip() for p in s.split('|') if p.strip()]
    return s


def parse_path(path: str):
    token_re = re.compile(r"([^\.\[\]]+)|\[(\d+)\]")
    tokens = []
    for m in token_re.finditer(path):
        name, idx = m.groups()
        if name is not None:
            tokens.append(name)
        else:
            tokens.append(int(idx))
    return tokens


def set_in_data(obj, tokens, value):
    cur = obj
    for i, tok in enumerate(tokens):
        last = (i == len(tokens) - 1)
        if isinstance(tok, int):
            if not isinstance(cur, list):
                raise TypeError(f"Expected list while handling index {tok} in path")
            while len(cur) <= tok:
                cur.append(None)
            if last:
                cur[tok] = value
                return
            if cur[tok] is None:
                nxt = tokens[i + 1]
                cur[tok] = {} if isinstance(nxt, str) else []
            cur = cur[tok]
        else:
            if last:
                if isinstance(cur, list):
                    raise TypeError("Attempting to set key on a list")
                cur[tok] = value
                return
            if isinstance(cur, list):
                raise TypeError("Attempting to traverse key on a list")
            if tok not in cur or cur[tok] is None:
                nxt = tokens[i + 1]
                cur[tok] = {} if isinstance(nxt, str) else []
            cur = cur[tok]


def flatten_json(obj, prefix=''):
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            yield from flatten_json(v, key)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            key = f"{prefix}[{i}]"
            yield from flatten_json(v, key)
    else:
        yield prefix, obj


@APP.route('/api/data', methods=['GET'])
def get_data():
    if not DATA_JSON.exists():
        return jsonify({'error': 'data file not found'}), 500
    with DATA_JSON.open('r', encoding='utf-8') as f:
        return jsonify(json.load(f))


@APP.route('/api/export-template', methods=['GET'])
def export_template():
    if not DATA_JSON.exists():
        return jsonify({'error': 'data file not found'}), 500
    with DATA_JSON.open('r', encoding='utf-8') as f:
        data = json.load(f)
    # Define which top-level prefixes are editable via CSV
    ALLOWED_PREFIXES = [
        'issuesOpenValue', 'netLossValue', 'MTD Risk Events', 'ytdRiskEvents',
        'appetiteConsumption', 'noOfMaterialIssues', 'SRT', 'KRIs',
        'alerts', 'controlSystems', 'svgElementMappings', 'indicatorConditions',
        'stressSituations', 'controlDetails', 'rightPanel', 'metadata',
        'srtDetails', 'gaugeSrtDetails'
    ]

    def is_editable_path(p: str) -> bool:
        # exact match for metadata.lastUpdated allowed, otherwise check prefixes
        if p == 'metadata.lastUpdated':
            return True
        for pref in ALLOWED_PREFIXES:
            if p == pref:
                return True
            if p.startswith(pref + '.') or p.startswith(pref + '[') or p.startswith(pref + '/'):
                return True
        return False

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['path', 'value'])
    for p, v in flatten_json(data):
        if not is_editable_path(p):
            continue
        if isinstance(v, list):
            writer.writerow([p, ';'.join(str(x) for x in v)])
        else:
            writer.writerow([p, '' if v is None else str(v)])
    out.seek(0)
    return Response(out.getvalue(), mimetype='text/csv')


@APP.route('/api/update', methods=['POST'])
def api_update():
    if not DATA_JSON.exists():
        return jsonify({'error': 'data file not found'}), 500
    # load current data
    with DATA_JSON.open('r', encoding='utf-8') as f:
        data = json.load(f)

    # support multipart CSV upload
    updated = False
    summary = []

    # Editable prefixes same as export rules
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

    if 'file' in request.files:
        file = request.files['file']
        stream = io.StringIO(file.read().decode('utf-8'))
        reader = csv.reader(stream)
        headers = next(reader, None)
        has_header = headers and len(headers) >= 2 and headers[0].strip().lower() == 'path'
        if not has_header:
            stream.seek(0)
            reader = csv.reader(stream)
        for row in reader:
            if not row or len(row) < 2:
                continue
            path = row[0].strip()
            raw = ','.join(row[1:]).strip()
            if not is_editable_path(path):
                summary.append({'path': path, 'skipped': True, 'reason': 'not-editable'})
                continue
            val = parse_value(raw)
            tokens = parse_path(path)
            set_in_data(data, tokens, val)
            summary.append({'path': path, 'value': val})
            updated = True
    else:
        # expect JSON payload {updates: [{path, value}, ...]} or {path:value} single
        payload = request.get_json(silent=True)
        if not payload:
            return jsonify({'error': 'no JSON body or file provided'}), 400
        if isinstance(payload, dict) and 'updates' in payload:
            updates = payload['updates']
        elif isinstance(payload, dict) and all(isinstance(v, dict) for v in payload.values()):
            # fallback: not expected
            return jsonify({'error': 'unexpected JSON shape'}), 400
        elif isinstance(payload, dict) and 'path' in payload and 'value' in payload:
            updates = [payload]
        else:
            # try to interpret payload as mapping of path->value
            updates = [{'path': k, 'value': v} for k, v in payload.items()]

        for item in updates:
            path = item.get('path')
            if path is None:
                continue
            if not is_editable_path(path):
                summary.append({'path': path, 'skipped': True, 'reason': 'not-editable'})
                continue
            raw = item.get('value')
            val = parse_value(raw)
            tokens = parse_path(path)
            set_in_data(data, tokens, val)
            summary.append({'path': path, 'value': val})
            updated = True

    if updated:
        backup = DATA_JSON.with_suffix('.json.bak')
        shutil.copy2(DATA_JSON, backup)
        with DATA_JSON.open('w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        # Return the updated data so clients can apply changes immediately without extra fetch
        return jsonify({'updated': True, 'summary': summary, 'data': data}), 200
    # Even when nothing was changed, return the current data for convenience
    return jsonify({'updated': False, 'summary': summary, 'data': data}), 200


def run():
    APP.run(host='0.0.0.0', port=5000, debug=False)


if __name__ == '__main__':
    run()
