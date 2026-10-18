import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertCircle, CheckCircle2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { getAuthToken } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  source: string;
}

interface MoonrakerPrinter {
  id: string;
  name: string;
  url: string;
  type: 'klipper';
  has_api_key: boolean;
}

interface Heater {
  current: number | null;
  target: number | null;
}

interface MoonrakerStatus {
  id: string;
  name: string;
  state: string;
  filename: string | null;
  message: string | null;
  progress_percent: number;
  print_duration_seconds: number | null;
  temperatures: {
    extruder: Heater;
    bed: Heater;
  };
}

const BASE = '/api/v1/plugins';

async function pluginRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body: { detail?: unknown } = await response.json().catch(() => ({}));
    const error = typeof body.detail === 'string'
      ? body.detail
      : `HTTP ${response.status}`;
    throw new Error(error);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function tempLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}°C`
    : '—';
}

function durationLabel(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function MoonrakerCard({
  printer,
  status,
  error,
  loading,
  canManage,
  onRemove,
  removing,
}: {
  printer: MoonrakerPrinter;
  status?: MoonrakerStatus;
  error: Error | null;
  loading: boolean;
  canManage: boolean;
  onRemove?: () => void;
  removing: boolean;
}) {
  const printing = status?.state === 'printing';
  const progress = Math.max(0, Math.min(100, status?.progress_percent ?? 0));

  return (
    <article className="rounded-xl border border-bambu-dark-tertiary bg-bambu-dark-secondary p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="w-4 h-4 text-bambu-green" />
            <h3 className="font-semibold text-white truncate">{printer.name}</h3>
            <span className="rounded-full bg-bambu-green/15 px-2 py-0.5 text-xs text-bambu-green">Klipper</span>
          </div>
          <p className="text-xs text-bambu-gray mt-1 break-all">{printer.url}</p>
        </div>
        {canManage && onRemove && (
          <button
            type="button"
            disabled={removing}
            onClick={onRemove}
            title="Remove this Moonraker connection"
            aria-label={`Remove ${printer.name}`}
            className="text-bambu-gray hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {error ? (
        <div className="flex gap-2 text-sm text-amber-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Unable to reach Moonraker. Check its address, API key, and network access.</span>
        </div>
      ) : !status ? (
        <p className="text-sm text-bambu-gray">{loading ? 'Connecting to Moonraker…' : 'Awaiting status…'}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className={printing ? 'text-bambu-green font-semibold' : 'text-bambu-gray'}>
              {status.state === 'standby' ? 'Idle' : status.state}
            </span>
            <span className="text-bambu-gray">{durationLabel(status.print_duration_seconds)} elapsed</span>
          </div>
          {status.filename && <p className="text-sm text-white truncate" title={status.filename}>{status.filename}</p>}
          {status.message && <p className="text-xs text-bambu-gray">{status.message}</p>}
          {printing && (
            <div>
              <div className="flex justify-between text-xs text-bambu-gray mb-1">
                <span>Print progress</span><span>{progress.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-bambu-dark-tertiary overflow-hidden">
                <div className="h-full bg-bambu-green transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-bambu-dark p-3">
              <p className="text-xs text-bambu-gray mb-1">Nozzle</p>
              <p className="text-white">{tempLabel(status.temperatures.extruder.current)}
                <span className="text-bambu-gray text-xs"> / {tempLabel(status.temperatures.extruder.target)}</span>
              </p>
            </div>
            <div className="rounded-lg bg-bambu-dark p-3">
              <p className="text-xs text-bambu-gray mb-1">Bed</p>
              <p className="text-white">{tempLabel(status.temperatures.bed.current)}
                <span className="text-bambu-gray text-xs"> / {tempLabel(status.temperatures.bed.target)}</span>
              </p>
            </div>
          </div>
        </>
      )}
    </article>
  );
}

export function KlipperPanel({ compact = false }: { compact?: boolean }) {
  const client = useQueryClient();
  const { authEnabled, hasPermission } = useAuth();
  const { showToast } = useToast();
  const canReadSettings = !authEnabled || hasPermission('settings:read');
  const canReadPrinters = !authEnabled || hasPermission('printers:read');
  const canManage = !authEnabled || hasPermission('settings:update');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);

  const plugins = useQuery({
    queryKey: ['bkb-plugins'],
    queryFn: () => pluginRequest<PluginInfo[]>(''),
    enabled: canReadSettings,
    retry: 1,
  });
  const moonraker = plugins.data?.find(p => p.id === 'moonraker');
  const printers = useQuery({
    queryKey: ['bkb-moonraker-printers'],
    queryFn: () => pluginRequest<MoonrakerPrinter[]>('/moonraker/printers'),
    enabled: Boolean(moonraker?.enabled && canReadPrinters),
    refetchInterval: 30000,
  });
  const printerList = printers.data ?? [];
  const statuses = useQueries({
    queries: printerList.map(printer => ({
      queryKey: ['bkb-moonraker-status', printer.id],
      queryFn: () => pluginRequest<MoonrakerStatus>(`/moonraker/printers/${encodeURIComponent(printer.id)}/status`),
      enabled: Boolean(moonraker?.enabled && canReadPrinters),
      staleTime: 3000,
      refetchInterval: 10000,
      retry: 0,
    })),
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => pluginRequest<PluginInfo>('/moonraker', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
    onSuccess: (updated) => {
      client.setQueryData<PluginInfo[]>(['bkb-plugins'], current =>
        current?.map(p => p.id === updated.id ? updated : p),
      );
      client.invalidateQueries({ queryKey: ['bkb-moonraker-printers'] });
      showToast(updated.enabled ? 'Moonraker plugin enabled' : 'Moonraker plugin disabled');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  const add = useMutation({
    mutationFn: () => pluginRequest<MoonrakerPrinter>('/moonraker/printers', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), url: url.trim(), api_key: apiKey.trim() || null }),
    }),
    onSuccess: () => {
      setName(''); setUrl(''); setApiKey('');
      client.invalidateQueries({ queryKey: ['bkb-moonraker-printers'] });
      showToast('Klipper printer added');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => pluginRequest<void>(`/moonraker/printers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      setRemoveId(null);
      client.invalidateQueries({ queryKey: ['bkb-moonraker-printers'] });
      showToast('Klipper printer removed');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() && url.trim()) add.mutate();
  };

  if (!canReadSettings || !canReadPrinters) return null;
  if (compact && (!moonraker?.enabled || printerList.length === 0)) return null;

  return (
    <section className="space-y-4" aria-label="Klipper printers">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Klipper / Moonraker</h2>
          <p className="text-sm text-bambu-gray">Read-only printer status, refreshed every 10 seconds.</p>
        </div>
        <div className="flex items-center gap-3">
          {!compact && canManage && moonraker && (
            <button
              type="button"
              onClick={() => toggle.mutate(!moonraker.enabled)}
              disabled={toggle.isPending}
              className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${moonraker.enabled ? 'bg-bambu-dark-tertiary text-white' : 'bg-bambu-green text-white'}`}
            >
              {toggle.isPending ? 'Saving…' : moonraker.enabled ? 'Disable plugin' : 'Enable plugin'}
            </button>
          )}
          {compact && <Link to="/klipper" className="text-sm text-bambu-green hover:underline">Manage Klipper</Link>}
          <button
            type="button"
            onClick={() => {
              client.invalidateQueries({ queryKey: ['bkb-moonraker-printers'] });
              client.invalidateQueries({ queryKey: ['bkb-moonraker-status'] });
            }}
            className="text-bambu-gray hover:text-white"
            aria-label="Refresh Klipper printers"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      {!compact && (
        <div className="rounded-xl border border-bambu-dark-tertiary bg-bambu-dark-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            {moonraker?.enabled ? <CheckCircle2 className="w-5 h-5 text-bambu-green" /> : <AlertCircle className="w-5 h-5 text-bambu-gray" />}
            <span className="text-white font-medium">Plugin settings</span>
          </div>
          {plugins.isLoading && <p className="text-bambu-gray text-sm">Checking plugin status…</p>}
          {plugins.error && <p className="text-red-400 text-sm">{(plugins.error as Error).message}</p>}
          {!plugins.isLoading && !plugins.error && !moonraker && (
            <p className="text-amber-400 text-sm">Moonraker plugin was not discovered. Check that the backend Phase 1 patch is deployed.</p>
          )}
          {moonraker && <p className="text-sm text-bambu-gray">{moonraker.description} Version {moonraker.version}. {moonraker.enabled ? 'Enabled' : 'Disabled'}.</p>}
        </div>
      )}
      {!compact && moonraker?.enabled && canManage && (
        <form onSubmit={submit} className="rounded-xl border border-bambu-dark-tertiary bg-bambu-dark-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 text-white font-semibold"><Plus className="w-4 h-4" /> Add Klipper printer</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-bambu-gray">Printer name
              <input required maxLength={100} value={name} onChange={e => setName(e.target.value)}
                placeholder="Ender 3 V2" className="mt-1 w-full rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2 text-white" />
            </label>
            <label className="text-sm text-bambu-gray">Moonraker URL
              <input required type="url" maxLength={512} value={url} onChange={e => setUrl(e.target.value)}
                placeholder="http://192.168.0.50:7125" className="mt-1 w-full rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2 text-white" />
            </label>
            <label className="text-sm text-bambu-gray sm:col-span-2">Moonraker API key (optional)
              <input type="password" autoComplete="off" maxLength={512} value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder="Leave blank if Moonraker does not require a key" className="mt-1 w-full rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2 text-white" />
            </label>
          </div>
          <button type="submit" disabled={add.isPending || !name.trim() || !url.trim()}
            className="rounded-lg bg-bambu-green px-4 py-2 text-white font-semibold disabled:opacity-50">
            {add.isPending ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Adding…</span> : 'Add printer'}
          </button>
          <p className="text-xs text-bambu-gray">The connection must be reachable from the BambKlipperBuddy server, not just this browser. Keep Moonraker on a trusted network.</p>
        </form>
      )}
      {moonraker?.enabled && (
        <>
          {printers.error && <p role="alert" className="text-sm text-red-400">Unable to list Klipper printers: {(printers.error as Error).message}</p>}
          {printers.isLoading && <p className="text-sm text-bambu-gray">Loading Klipper printers…</p>}
          {!printers.isLoading && !printers.error && printerList.length === 0 && !compact && (
            <p className="text-sm text-bambu-gray">No Klipper printers configured. Add a Moonraker connection above.</p>
          )}
          {printerList.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {printerList.map((printer, index) => (
                <MoonrakerCard
                  key={printer.id}
                  printer={printer}
                  status={statuses[index]?.data}
                  error={statuses[index]?.error as Error | null}
                  loading={statuses[index]?.isLoading ?? false}
                  canManage={canManage && !compact}
                  removing={remove.isPending}
                  onRemove={!compact && canManage ? () => setRemoveId(printer.id) : undefined}
                />
              ))}
            </div>
          )}
        </>
      )}
      {removeId && !compact && (
        <div role="dialog" aria-modal="true" aria-label="Confirm Klipper printer removal"
          className="rounded-xl border border-red-500/40 bg-bambu-dark-secondary p-4 space-y-3">
          <p className="text-white">Remove this Klipper connection? The printer's Klipper firmware and files will not be changed.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => remove.mutate(removeId)} disabled={remove.isPending}
              className="rounded-lg bg-red-600 px-3 py-2 text-white disabled:opacity-50">Remove connection</button>
            <button type="button" onClick={() => setRemoveId(null)}
              className="rounded-lg bg-bambu-dark-tertiary px-3 py-2 text-white">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
