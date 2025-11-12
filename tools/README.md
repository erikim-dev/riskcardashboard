# Riskcardashboard API

This is a small Flask-based API to make `data/risk-data.json` dynamic. It provides endpoints to read the current JSON, apply updates (JSON or CSV upload), and export a CSV template of current fields.

Quick start

1. Create a Python virtual environment (recommended) and install deps:

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
python -m pip install -r tools\requirements.txt
```

2. Run the API:

```powershell
python tools\api.py
```

3. Endpoints

- GET http://localhost:5000/api/data — return current JSON
- GET http://localhost:5000/api/export-template — return a CSV of all JSON leaf paths and values
- POST http://localhost:5000/api/update — apply updates. Either:
  - Send JSON: { "updates": [{"path":"srtDetails.items[0]","value":"Foo"}, ...] }
  - Or multipart/form-data with `file` pointing to a CSV with header `path,value`.

The API writes a backup `data/risk-data.json.bak` before saving changes.

Security note

This is a local admin tool. If you deploy it to a networked server, secure it (authentication + HTTPS) before use.
