export type Status = 'READY' | 'BUSY' | 'DRAINING'
export type DeviceType = 'CPU' | 'GPU'
export type Role = 'system' | 'user' | 'assistant'

export interface OkResponse {
  ok: boolean
}

export interface ErrorResponse {
  error: string
  detail: string
}

export interface RegisterRequest {
  server_id: string
  endpoint: string
  models: string[]
  max_concurrency: number
  device_type: DeviceType
  context_limit?: number | null
  vram_gb?: number | null
}

export interface HeartbeatRequest {
  server_id: string
  timestamp_ms: number
  status: Status
  in_flight: number
  ema_tps?: number | null
  last_job_ms?: number | null
}

export interface RouteRequest {
  request_id: string
  timestamp_ms: number
  model_id: string
  prompt_chars: number
  max_tokens: number
  estimated_prompt_tokens?: number | null
}

export interface RouteResponse {
  request_id: string
  server_id: string
  endpoint: string
  reason: string
}

export interface Message {
  role: Role
  content: string
}

export interface RunRequest {
  request_id: string
  timestamp_ms: number
  model_id: string
  max_tokens: number
  messages: Message[]
}

export interface Usage {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
}

export interface Timing {
  elapsed_ms: number
}

export interface Output {
  role: Role
  content: string
}

export interface RunResponse {
  request_id: string
  model_id: string
  cached?: boolean | null
  output: Output
  usage: Usage
  timing: Timing
}

export interface NetworkContractClientOptions {
  routerBaseUrl?: string
  fetchImpl?: typeof fetch
}