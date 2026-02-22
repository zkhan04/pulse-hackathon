import asyncio
import json
import os
import time
from collections import OrderedDict
from typing import Literal, Optional

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

Role = Literal['system', 'user', 'assistant']


class Message(BaseModel):
    role: Role
    content: str


class RunRequest(BaseModel):
    request_id: str
    timestamp_ms: int
    model_id: str
    max_tokens: int = Field(ge=1)
    messages: list[Message] = Field(min_length=1)


class Usage(BaseModel):
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    total_tokens: Optional[int]


class Timing(BaseModel):
    elapsed_ms: int = Field(ge=0)


class Output(BaseModel):
    role: Role
    content: str


class RunResponse(BaseModel):
    request_id: str
    model_id: str
    cached: Optional[bool] = None
    output: Output
    usage: Usage
    timing: Timing


class ErrorResponse(BaseModel):
    error: str
    detail: str


class AgentConfig(BaseModel):
    host: str = '0.0.0.0'
    port: int = 8081
    lmstudio_base_url: str = 'http://127.0.0.1:1234'
    lmstudio_chat_path: str = '/v1/chat/completions'
    max_concurrency: int = 1
    idempotency_ttl_seconds: int = 180
    idempotency_max_entries: int = 1000
    mock_mode: bool = True
    request_timeout_seconds: float = 30.0
    model_map: dict[str, str] = {}


class AgentState:
    def __init__(self, config: AgentConfig):
        self.config = config
        self.in_flight = 0
        self.status: str = 'READY'
        self.last_job_ms: Optional[int] = None
        self.ema_tps: Optional[float] = None
        self._ema_alpha = 0.2
        self._lock = asyncio.Lock()
        self._cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
        self._inflight_by_request: dict[str, asyncio.Future] = {}

    def _prune_cache(self) -> None:
        now = time.time()
        expired = [k for k, (exp, _) in self._cache.items() if exp <= now]
        for k in expired:
            self._cache.pop(k, None)
        while len(self._cache) > self.config.idempotency_max_entries:
            self._cache.popitem(last=False)

    def get_cached(self, request_id: str) -> Optional[dict]:
        self._prune_cache()
        entry = self._cache.get(request_id)
        if not entry:
            return None
        exp, payload = entry
        if exp <= time.time():
            self._cache.pop(request_id, None)
            return None
        self._cache.move_to_end(request_id)
        cached_payload = dict(payload)
        cached_payload['cached'] = True
        return cached_payload

    def put_cached(self, request_id: str, payload: dict) -> None:
        self._prune_cache()
        expires_at = time.time() + self.config.idempotency_ttl_seconds
        self._cache[request_id] = (expires_at, payload)
        self._cache.move_to_end(request_id)
        self._prune_cache()

    def get_inflight_future(self, request_id: str) -> Optional[asyncio.Future]:
        fut = self._inflight_by_request.get(request_id)
        if fut is not None and fut.done():
            self._inflight_by_request.pop(request_id, None)
            return None
        return fut

    def start_inflight_future(self, request_id: str) -> asyncio.Future:
        fut = asyncio.get_running_loop().create_future()
        self._inflight_by_request[request_id] = fut
        return fut

    def finish_inflight_future(self, request_id: str, payload: Optional[dict], error: Optional[Exception]) -> None:
        fut = self._inflight_by_request.pop(request_id, None)
        if fut is None or fut.done():
            return
        if error is not None:
            fut.set_exception(error)
            return
        fut.set_result(payload)

    def update_metrics(self, elapsed_ms: int, completion_tokens: Optional[int]) -> None:
        self.last_job_ms = elapsed_ms
        if not completion_tokens or elapsed_ms <= 0:
            return
        if completion_tokens < 4:
            return
        tps = completion_tokens / (elapsed_ms / 1000)
        if tps <= 0:
            return
        if self.ema_tps is None:
            self.ema_tps = tps
        else:
            self.ema_tps = (self._ema_alpha * tps) + ((1 - self._ema_alpha) * self.ema_tps)


def load_config() -> AgentConfig:
    raw_model_map = os.getenv('MODEL_MAP_JSON', '{}')
    try:
        model_map = json.loads(raw_model_map)
        if not isinstance(model_map, dict):
            model_map = {}
    except json.JSONDecodeError:
        model_map = {}

    return AgentConfig(
        host=os.getenv('HOST', '0.0.0.0'),
        port=int(os.getenv('PORT', '8081')),
        lmstudio_base_url=os.getenv('LMSTUDIO_BASE_URL', 'http://127.0.0.1:1234'),
        lmstudio_chat_path=os.getenv('LMSTUDIO_CHAT_PATH', '/v1/chat/completions'),
        max_concurrency=int(os.getenv('MAX_CONCURRENCY', '1')),
        idempotency_ttl_seconds=int(os.getenv('IDEMPOTENCY_TTL_SECONDS', '180')),
        idempotency_max_entries=int(os.getenv('IDEMPOTENCY_MAX_ENTRIES', '1000')),
        mock_mode=os.getenv('MOCK_MODE', 'true').lower() == 'true',
        request_timeout_seconds=float(os.getenv('REQUEST_TIMEOUT_SECONDS', '30')),
        model_map=model_map,
    )


def estimate_tokens_from_text(text: str) -> int:
    return (len(text) + 3) // 4


def lmstudio_model_name(config: AgentConfig, model_id: str) -> str:
    return config.model_map.get(model_id, model_id)


async def call_lmstudio(req: RunRequest, config: AgentConfig) -> tuple[str, dict]:
    if config.mock_mode:
        await asyncio.sleep(0.35)
        content = f"(mock-compute:{req.model_id}) {req.messages[-1].content[:180]}"
        completion_tokens = estimate_tokens_from_text(content)
        return content, {
            'prompt_tokens': estimate_tokens_from_text(''.join(m.content for m in req.messages)),
            'completion_tokens': completion_tokens,
            'total_tokens': None,
        }

    payload = {
        'model': lmstudio_model_name(config, req.model_id),
        'messages': [m.model_dump() for m in req.messages],
        'max_tokens': req.max_tokens,
        'stream': False,
    }
    timeout = httpx.Timeout(connect=0.5, read=config.request_timeout_seconds, write=10.0, pool=5.0)
    url = f"{config.lmstudio_base_url.rstrip('/')}{config.lmstudio_chat_path}"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload)
            data = response.json()
    except httpx.ReadTimeout as e:
        raise HTTPException(status_code=504, detail='LMStudio upstream timeout') from e
    except httpx.ConnectError as e:
        raise HTTPException(status_code=504, detail='LMStudio upstream unavailable') from e
    except httpx.HTTPError as e:
        raise HTTPException(status_code=504, detail=f'LMStudio upstream error: {e.__class__.__name__}') from e

    if response.status_code >= 400:
        detail = data.get('error', {}).get('message') if isinstance(data, dict) else None
        raise HTTPException(status_code=400, detail=detail or f'LMStudio error {response.status_code}')

    try:
        output_text = data['choices'][0]['message']['content']
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=504, detail='LMStudio response missing assistant output') from e

    usage = data.get('usage') or {}
    prompt_tokens = usage.get('prompt_tokens')
    completion_tokens = usage.get('completion_tokens')
    if completion_tokens is None:
        completion_tokens = estimate_tokens_from_text(output_text)
    total_tokens = usage.get('total_tokens')
    if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
        total_tokens = prompt_tokens + completion_tokens

    return output_text, {
        'prompt_tokens': prompt_tokens,
        'completion_tokens': completion_tokens,
        'total_tokens': total_tokens,
    }


config = load_config()
state = AgentState(config)
app = FastAPI(title='Compute Agent', version='0.0.1')


@app.get('/health')
async def health() -> dict:
    return {
        'ok': True,
        'mock_mode': config.mock_mode,
        'in_flight': state.in_flight,
        'max_concurrency': config.max_concurrency,
        'status': state.status,
        'last_job_ms': state.last_job_ms,
        'ema_tps': state.ema_tps,
    }


@app.post('/run', response_model=RunResponse, responses={400: {'model': ErrorResponse}, 429: {'model': ErrorResponse}, 504: {'model': ErrorResponse}})
async def run_completion(req: RunRequest) -> RunResponse:
    if config.model_map and req.model_id not in config.model_map:
        raise HTTPException(status_code=400, detail=f'Unknown model_id: {req.model_id}')

    async with state._lock:
        cached = state.get_cached(req.request_id)
        if cached is not None:
            return RunResponse.model_validate(cached)

        existing_future = state.get_inflight_future(req.request_id)
        if existing_future is not None:
            # Duplicate retry while original is still running; share the same result.
            shared_future = existing_future
        else:
            shared_future = None

        if shared_future is None and state.in_flight >= config.max_concurrency:
            state.status = 'BUSY'
            raise HTTPException(status_code=429, detail='SERVER_BUSY')
        if shared_future is None:
            state.in_flight += 1
            state.status = 'BUSY' if state.in_flight >= config.max_concurrency else 'READY'
            owned_future = state.start_inflight_future(req.request_id)
        else:
            owned_future = None

    if shared_future is not None:
        payload = await shared_future
        payload = dict(payload)
        payload['cached'] = True
        return RunResponse.model_validate(payload)

    started = time.perf_counter()
    response_payload: Optional[dict] = None
    caught_http_exc: Optional[HTTPException] = None
    caught_other_exc: Optional[Exception] = None
    try:
        output_text, usage_dict = await call_lmstudio(req, config)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        state.update_metrics(elapsed_ms, usage_dict.get('completion_tokens'))

        response_payload = {
            'request_id': req.request_id,
            'model_id': req.model_id,
            'output': {'role': 'assistant', 'content': output_text},
            'usage': usage_dict,
            'timing': {'elapsed_ms': elapsed_ms},
        }
        state.put_cached(req.request_id, response_payload)
        return RunResponse.model_validate(response_payload)
    except HTTPException as e:
        caught_http_exc = e
        raise e
    except Exception as e:  # noqa: BLE001
        caught_other_exc = e
        raise HTTPException(status_code=504, detail=f'Unhandled compute error: {e.__class__.__name__}') from e
    finally:
        async with state._lock:
            if owned_future is not None:
                if response_payload is not None:
                    state.finish_inflight_future(req.request_id, response_payload, None)
                elif caught_http_exc is not None:
                    state.finish_inflight_future(req.request_id, None, caught_http_exc)
                elif caught_other_exc is not None:
                    state.finish_inflight_future(req.request_id, None, caught_other_exc)
                state.in_flight = max(0, state.in_flight - 1)
            state.status = 'BUSY' if state.in_flight >= config.max_concurrency else 'READY'


@app.exception_handler(HTTPException)
async def http_exception_handler(_, exc: HTTPException):
    from fastapi.responses import JSONResponse

    status_to_error = {
        400: 'BAD_REQUEST',
        429: 'SERVER_BUSY',
        504: 'UPSTREAM_TIMEOUT',
    }
    error_code = status_to_error.get(exc.status_code, 'ERROR')
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={'error': error_code, 'detail': detail})


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('main:app', host=config.host, port=config.port, reload=False)
