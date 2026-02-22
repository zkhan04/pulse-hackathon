import os
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware


LMSTUDIO_DEFAULT_BASE_URL = os.getenv('LMSTUDIO_BASE_URL', 'http://127.0.0.1:1234/v1')
REQUEST_TIMEOUT_SECONDS = float(os.getenv('REQUEST_TIMEOUT_SECONDS', '60'))
ALLOWED_ORIGINS = os.getenv('ALLOWED_ORIGINS', 'http://localhost:3000').split(',')

app = FastAPI(title='LM Studio Bridge', version='0.0.1')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/health')
async def health() -> dict[str, Any]:
    return {
        'ok': True,
        'lmstudio_base_url': LMSTUDIO_DEFAULT_BASE_URL,
    }


@app.post('/lmstudio')
async def lmstudio_proxy(request: Request) -> Any:
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail='Invalid JSON body') from exc

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail='JSON body must be an object')

    base_url = str(body.pop('base_url', LMSTUDIO_DEFAULT_BASE_URL)).rstrip('/')
    upstream_url = f'{base_url}/chat/completions'

    outgoing_headers: dict[str, str] = {}
    auth = request.headers.get('authorization')
    if auth:
        outgoing_headers['authorization'] = auth

    timeout = httpx.Timeout(connect=5.0, read=REQUEST_TIMEOUT_SECONDS, write=30.0, pool=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            upstream = await client.post(upstream_url, json=body, headers=outgoing_headers)
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=502, detail='Cannot reach LM Studio') from exc
    except httpx.ReadTimeout as exc:
        raise HTTPException(status_code=504, detail='LM Studio request timed out') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'LM Studio HTTP error: {exc.__class__.__name__}') from exc

    data: Any
    try:
        data = upstream.json()
    except Exception:
        data = {'detail': upstream.text}

    if upstream.status_code >= 400:
        detail = None
        if isinstance(data, dict):
            detail = data.get('error', {}).get('message') if isinstance(data.get('error'), dict) else data.get('error')
            detail = detail or data.get('detail')
        raise HTTPException(status_code=upstream.status_code, detail=detail or f'LM Studio error {upstream.status_code}')

    return data


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('main:app', host='0.0.0.0', port=8080, reload=False)
