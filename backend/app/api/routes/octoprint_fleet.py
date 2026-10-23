"""Multi-OctoPrint integration. Explicit UI registration; no legacy auto-import.

Only RFC1918 IP endpoints are permitted, to avoid SSRF from config-edit permissions.
Credentials remain in the Bambuddy data volume and never leave the backend.
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import uuid
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.core.auth import RequirePermissionIfAuthEnabled, RequireCameraStreamTokenIfAuthEnabled
from backend.app.core.config import settings as app_settings
from backend.app.core.permissions import Permission

router = APIRouter(prefix="/octoprint-fleet", tags=["octoprint-fleet"])
STORE = app_settings.base_dir / "octoprint_fleet.json"
WRITE_LOCK = asyncio.Lock()


class Registration(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=10, max_length=512)
    api_key: str = Field(default="", max_length=1024)
    camera_url: str = Field(default="", max_length=1024)
    snapshot_url: str = Field(default="", max_length=1024)
    camera_mode: str = "mjpeg"


class Update(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    url: str | None = Field(default=None, min_length=10, max_length=512)
    api_key: str | None = Field(default=None, max_length=1024)
    camera_url: str | None = Field(default=None, max_length=1024)
    snapshot_url: str | None = Field(default=None, max_length=1024)
    camera_mode: str | None = None


def checked_url(raw: str, optional: bool = False) -> str:
    raw = raw.strip().rstrip("/")
    if optional and not raw:
        return ""
    try:
        parts = urlsplit(raw)
        host = parts.hostname or ""
        addr = ipaddress.ip_address(host)
        private = (isinstance(addr, ipaddress.IPv4Address) and any(addr in network for network in (
            ipaddress.ip_network('10.0.0.0/8'), ipaddress.ip_network('172.16.0.0/12'),
            ipaddress.ip_network('192.168.0.0/16')))
            or isinstance(addr, ipaddress.IPv6Address) and addr in ipaddress.ip_network('fc00::/7'))
        if parts.scheme not in ('http', 'https') or not private:
            raise ValueError('invalid endpoint')
        if parts.username or parts.password or parts.fragment or not host or any(x in raw for x in ('\\n', '\\r', '\\t')):
            raise ValueError('embedded credentials/fragment not allowed')
        if parts.port is not None and parts.port < 1:
            raise ValueError('invalid port')
    except (ValueError, TypeError) as error:
        raise HTTPException(422, 'Use a valid http(s) URL with an RFC1918 LAN IP, without credentials') from error
    return raw


def _read() -> list[dict]:
    if not STORE.exists():
        return []
    return json.loads(STORE.read_text('utf-8'))


def _save(rows: list[dict]):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_name(STORE.name + '.tmp')
    descriptor = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as fh:
        json.dump(rows, fh, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, STORE)
    STORE.chmod(0o600)


def _row(id: str) -> dict:
    row = next((p for p in _read() if p['id'] == id), None)
    if row is None:
        raise HTTPException(404, 'OctoPrint printer not found')
    return row


def _public(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != 'api_key'} | {'has_api_key': bool(row.get('api_key'))}


def _validated(data: dict) -> dict:
    data['name'] = data['name'].strip()
    if not data['name']:
        raise HTTPException(422, 'Printer name required')
    data['url'] = checked_url(data['url'])
    data['camera_url'] = checked_url(data.get('camera_url', ''), optional=True)
    data['snapshot_url'] = checked_url(data.get('snapshot_url', ''), optional=True)
    if data['camera_mode'] not in ('mjpeg', 'snapshot'):
        raise HTTPException(422, 'Camera format must be mjpeg or snapshot')
    return data


@router.get('/printers')
async def list_printers(_: object = RequirePermissionIfAuthEnabled(Permission.PRINTERS_READ)):
    return [_public(row) for row in _read()]


@router.post('/printers', status_code=201)
async def add_printer(config: Registration, _: object = RequirePermissionIfAuthEnabled(Permission.SETTINGS_UPDATE)):
    record = _validated(config.model_dump()) | {'id': uuid.uuid4().hex}
    async with WRITE_LOCK:
        rows = _read()
        rows.append(record)
        _save(rows)
    return _public(record)


@router.patch('/printers/{id}')
async def edit_printer(id: str, patch: Update, _: object = RequirePermissionIfAuthEnabled(Permission.SETTINGS_UPDATE)):
    async with WRITE_LOCK:
        rows = _read()
        idx = next((i for i, p in enumerate(rows) if p['id'] == id), -1)
        if idx < 0:
            raise HTTPException(404, 'OctoPrint printer not found')
        changes = patch.model_dump(exclude_unset=True)
        if not changes.get('api_key'):
            changes.pop('api_key', None)  # empty value keeps existing secret
        record = _validated({**rows[idx], **changes})
        rows[idx] = record
        _save(rows)
    return _public(record)


@router.delete('/printers/{id}', status_code=204)
async def delete_printer(id: str, _: object = RequirePermissionIfAuthEnabled(Permission.SETTINGS_UPDATE)):
    async with WRITE_LOCK:
        rows = _read()
        kept = [r for r in rows if r['id'] != id]
        if len(kept) == len(rows):
            raise HTTPException(404, 'OctoPrint printer not found')
        _save(kept)


async def _octo(row: dict, method: str, path: str, *, payload=None, files=None) -> dict:
    # Never enable redirects, proxy vars, or user-supplied destinations.
    headers = {'X-Api-Key': row['api_key']} if row.get('api_key') else {}
    url = row['url'] + path
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=False, trust_env=False) as client:
            response = await client.request(method, url, headers=headers, json=payload, files=files)
        if response.status_code >= 400:
            raise HTTPException(502, f'OctoPrint returned HTTP {response.status_code}')
        if 300 <= response.status_code < 400:
            raise HTTPException(502, 'OctoPrint redirect refused')
        return response.json() if response.content else {}
    except (httpx.RequestError, ValueError) as error:
        raise HTTPException(502, 'Cannot reach OctoPrint') from error


@router.get('/printers/{id}/status')
async def status(id: str, _: object = RequirePermissionIfAuthEnabled(Permission.PRINTERS_READ)):
    row = _row(id)
    result = {
        'id': id, 'name': row['name'], 'url': row['url'], 'configured': True,
        'api_reachable': False, 'connected': False, 'state': 'Offline',
        'filename': None, 'progress_percent': None, 'print_time_seconds': None,
        'print_time_left_seconds': None, 'message': None,
        'temperatures': {'extruder': {'current': None, 'target': None}, 'bed': {'current': None, 'target': None}},
        'camera': {k: row.get(k, '') for k in ('camera_url', 'snapshot_url', 'camera_mode')},
    }
    try:
        job, printer = await asyncio.gather(_octo(row, 'GET', '/api/job'), _octo(row, 'GET', '/api/printer'))
        result['api_reachable'] = True
        result['connected'] = bool(printer.get('state', {}).get('flags', {}).get('operational') or printer.get('state', {}).get('flags', {}).get('printing') or printer.get('state', {}).get('flags', {}).get('paused'))
        result['state'] = job.get('state') or printer.get('state', {}).get('text') or 'Unknown'
        task = job.get('job') or {}
        result['filename'] = (task.get('file') or {}).get('display') or (task.get('file') or {}).get('name')
        progress = job.get('progress') or {}
        result['progress_percent'] = progress.get('completion')
        result['print_time_seconds'] = progress.get('printTime')
        result['print_time_left_seconds'] = progress.get('printTimeLeft')
        temp = printer.get('temperature') or {}
        result['temperatures'] = {
            'extruder': {'current': (temp.get('tool0') or {}).get('actual'), 'target': (temp.get('tool0') or {}).get('target')},
            'bed': {'current': (temp.get('bed') or {}).get('actual'), 'target': (temp.get('bed') or {}).get('target')},
        }
    except HTTPException as error:
        result['message'] = error.detail
    return result


@router.get('/printers/{id}/files')
async def files(id: str, _: object = RequirePermissionIfAuthEnabled(Permission.PRINTERS_FILES)):
    body = await _octo(_row(id), 'GET', '/api/files/local')
    return {'files': [{'name': f['name'], 'size': f.get('size')} for f in body.get('files', []) if f.get('type') == 'machinecode' and f.get('name')]}


class ConfirmCommand(BaseModel):
    confirm: bool
    name: str = ''


@router.post('/printers/{id}/job/{action}')
async def job_action(id: str, action: str, request: ConfirmCommand, _: object = RequirePermissionIfAuthEnabled(Permission.PRINTERS_CONTROL)):
    if not request.confirm or action not in ('pause', 'resume', 'cancel'):
        raise HTTPException(422, 'Explicit confirmation and valid action required')
    payload = {'command': 'cancel'} if action == 'cancel' else {'command': 'pause', 'action': action}
    await _octo(_row(id), 'POST', '/api/job', payload=payload)
    return {'ok': True}


@router.post('/printers/{id}/files/start')
async def start_print(id: str, request: ConfirmCommand, _: object = RequirePermissionIfAuthEnabled(Permission.PRINTERS_CONTROL)):
    if not request.confirm or not request.name or '/' in request.name or '\\' in request.name:
        raise HTTPException(422, 'Explicit confirmation and simple filename required')
    await _octo(_row(id), 'POST', '/api/files/local/' + quote(request.name, safe=''), payload={'command': 'select', 'print': True})
    return {'ok': True}


@router.post('/printers/{id}/files')
async def upload_file(id: str, file: UploadFile = File(...), _: object = RequirePermissionIfAuthEnabled(Permission.PRINTERS_FILES)):
    if not file.filename or not file.filename.lower().endswith(('.gcode', '.gco', '.g')):
        raise HTTPException(422, 'G-code files only')
    data = await file.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024:
        raise HTTPException(413, '32 MiB maximum')
    await _octo(_row(id), 'POST', '/api/files/local', files={'file': (Path(file.filename).name, data, 'application/octet-stream')})
    return {'ok': True}


@router.get('/camera-stream/{id}')
async def camera_stream(id: str, _: object = RequireCameraStreamTokenIfAuthEnabled):
    row = _row(id)
    source = (row.get('snapshot_url') if row.get('camera_mode') == 'snapshot' and row.get('snapshot_url') else row.get('camera_url'))
    if not source:
        raise HTTPException(404, 'Camera is not configured')
    checked_url(source)
    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=5, read=30, write=5, pool=5), follow_redirects=False, trust_env=False)
    try:
        response = await client.send(client.build_request('GET', source), stream=True)
    except httpx.RequestError as error:
        await client.aclose()
        raise HTTPException(502, 'Camera unavailable') from error
    if response.status_code != 200:
        await response.aclose()
        await client.aclose()
        raise HTTPException(502, 'Camera returned non-200 HTTP status')
    content_type = response.headers.get('content-type', '')
    # Preserve the original multipart boundary: browsers need the exact value.
    if row.get('camera_mode') == 'snapshot':
        if not content_type.lower().startswith('image/jpeg'):
            await response.aclose()
            await client.aclose()
            raise HTTPException(502, 'Expected JPEG image')
    elif not content_type.lower().startswith('multipart/x-mixed-replace'):
        await response.aclose()
        await client.aclose()
        raise HTTPException(502, 'Expected MJPEG stream')

    async def forward():
        try:
            async for part in response.aiter_raw(chunk_size=16384):
                yield part
        finally:
            await response.aclose()
            await client.aclose()

    return StreamingResponse(forward(), media_type=content_type, headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})