import { getAuthToken, withStreamToken } from './client';

export interface OctoFleetConfig {
  id: string;
  name: string;
  url: string;
  has_api_key: boolean;
  camera_url: string;
  snapshot_url: string;
  camera_mode: 'mjpeg' | 'snapshot';
}
export type OctoFleetInput = Omit<OctoFleetConfig, 'id' | 'has_api_key'> & { api_key: string };
export interface OctoFleetStatus {
  id: string;
  name: string;
  url: string;
  configured: boolean;
  api_reachable: boolean;
  connected: boolean;
  state: string;
  filename: string | null;
  progress_percent: number | null;
  print_time_seconds: number | null;
  print_time_left_seconds: number | null;
  message: string | null;
  temperatures: {extruder: {current: number | null; target: number | null};bed:{current: number | null; target: number | null}};
  camera: {camera_url: string;snapshot_url:string;camera_mode:'mjpeg'|'snapshot'};
}
export async function octoFleetFetch<T>(route: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string,string> = {
    ...(init.body instanceof FormData ? {} : {'Content-Type':'application/json'}),
    ...(token ? {Authorization:`Bearer ${token}`} : {}),
  };
  const resp = await fetch('/api/v1/octoprint-fleet' + route, {
    ...init, headers: {...headers, ...(init.headers as Record<string,string> ?? {})},
    credentials: 'include', cache: 'no-store',
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as {detail?: string};
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${resp.status}`);
  }
  return resp.status === 204 ? (undefined as T) : await resp.json() as T;
}
export function octoCameraUrl(id: string) {
  return withStreamToken(`/api/v1/octoprint-fleet/camera-stream/${encodeURIComponent(id)}`);
}