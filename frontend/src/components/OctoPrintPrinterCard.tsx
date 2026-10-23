import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera, CheckCircle2, Clock3, ExternalLink, FileCode2, FolderOpen,
  Loader2, Pause, Play, Printer, RefreshCw, Settings2, Thermometer,
  Upload, VideoOff, X, XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { octoFleetFetch, octoCameraUrl, type OctoFleetStatus } from '../api/octoprintFleet';

interface Props {
  status: OctoFleetStatus;
  cardSize: number;
}

const temperature = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}°C`;

const clock = (seconds: number | null | undefined) => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

export function octoStateGroup(status: OctoFleetStatus): string {
  if (!status.api_reachable || !status.connected) return 'offline';
  if (/printing/i.test(status.state)) return 'printing';
  if (/paused|pausing/i.test(status.state)) return 'paused';
  if (/error|fail|closed/i.test(status.state)) return 'error';
  if (/finish|complete/i.test(status.state)) return 'finished';
  return 'idle';
}

export function OctoPrintPrinterCard({ status, cardSize }: Props) {
  const { authEnabled, hasPermission } = useAuth();
  const client = useQueryClient();
  const canControl = !authEnabled || hasPermission('printers:control');
  const canFiles = !authEnabled || hasPermission('printers:files');
  const canCamera = !authEnabled || hasPermission('camera:view');
  const canSettings = !authEnabled || hasPermission('settings:read');
  const compact = cardSize === 1;
  const sizeIndex = Math.min(4, Math.max(1, cardSize)) - 1;
  const cardSpacing = ['p-3 gap-3', 'p-5 gap-4', 'p-6 gap-5', 'p-8 gap-6'][sizeIndex];
  const titleSize = ['text-base', 'text-base', 'text-lg', 'text-xl'][sizeIndex];
  const iconSize = ['h-10 w-10', 'h-12 w-12', 'h-14 w-14', 'h-16 w-16'][sizeIndex];

  const state = octoStateGroup(status);
  const printing = state === 'printing';
  const paused = state === 'paused';
  const progress = Math.max(0, Math.min(100, status.progress_percent ?? 0));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [snapshotTick, setSnapshotTick] = useState(0);
  const [selected, setSelected] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState('');

  const files = useQuery({
    queryKey: ['octofleet-files', status.id],
    queryFn: () => octoFleetFetch<{ files: { name: string; size?: number; date?: number }[] }>(`/printers/${status.id}/files`),
    enabled: filesOpen && canFiles,
    staleTime: 10000,
  });

  const action = useMutation({
    mutationFn: async (operation: 'start' | 'pause' | 'resume' | 'cancel') => {
      const messages = {
        start: `Start ${selected} on this printer? Verify that the printer is ready.`,
        pause: 'Pause the print?',
        resume: 'Resume the print?',
        cancel: 'Cancel the print? This cannot be undone.',
      };
      if (!window.confirm(messages[operation])) return false;
      if (operation === 'start') {
        if (!selected) return false;
        await octoFleetFetch(`/printers/${status.id}/files/start`, { method: 'POST', body: JSON.stringify({ name: selected, confirm: true }) });
      } else {
        await octoFleetFetch(`/printers/${status.id}/job/${operation}`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
      }
      return true;
    },
    onSuccess: (didRun) => {
      if (!didRun) return;
      setFeedback('Command accepted by OctoPrint');
      void client.invalidateQueries({ queryKey: ['octofleet-status', status.id] });
      if (selected) setFilesOpen(false);
    },
    onError: (error: Error) => setFeedback(error.message),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!window.confirm(`Upload ${file.name} to OctoPrint? Uploading does not start printing.`)) return false;
      const data = new FormData();
      data.append('file', file);
      await octoFleetFetch(`/printers/${status.id}/files`, { method: 'POST', body: data });
      return true;
    },
    onSuccess: (didUpload) => {
      if (!didUpload) return;
      setFeedback('G-code uploaded to OctoPrint');
      setUploadFile(null);
      void client.invalidateQueries({ queryKey: ['octofleet-files', status.id] });
    },
    onError: (error: Error) => setFeedback(error.message),
  });

  useEffect(() => {
    if (!cameraOpen && !filesOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setCameraOpen(false); setFilesOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cameraOpen, filesOpen]);

  const busy = action.isPending || upload.isPending;
  const cameraUrl = status.camera?.camera_url?.trim() || status.camera?.snapshot_url?.trim() || '';
  
  const liveSrc = octoCameraUrl(status.id);
  const snapshotMode = status.camera?.camera_mode === 'snapshot';
  const imageSrc = snapshotMode ? `${liveSrc}${liveSrc.includes('?') ? '&' : '?'}_=${snapshotTick}` : liveSrc;
  useEffect(() => {
    if (!cameraOpen || !snapshotMode) return;
    const interval = window.setInterval(() => setSnapshotTick(t => t + 1), 4000);
    return () => window.clearInterval(interval);
  }, [cameraOpen, snapshotMode]);
  const statusColor = status.connected ? 'bg-bambu-green/10 text-bambu-green' : 'bg-red-500/10 text-red-400';

  return <article
    id={`octoprint-card-${status.id}`}
    aria-label={`${status.name} printer`}
    className={`relative flex h-full flex-col rounded-xl border border-bambu-dark-tertiary bg-bambu-dark-secondary text-white shadow-sm ${cardSpacing}`}
  >
    {/* Stock-card layout: model, connection chips, job summary, temperatures, actions. */}
    <header className="flex items-start gap-3 min-w-0">
      <div className={`${iconSize} shrink-0 rounded-lg border border-bambu-dark-tertiary bg-bambu-dark flex items-center justify-center`}>
        <Printer className="h-7 w-7 text-bambu-gray" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className={`${titleSize} font-semibold truncate`}>{status.name || 'OctoPrint'}</h3>
        <p className="text-xs text-bambu-gray">OctoPrint printer</p>
      </div>
      <button type="button" className="rounded p-1.5 text-bambu-gray hover:bg-bambu-dark-tertiary hover:text-white"
        title={`Refresh ${status.name}`} aria-label={`Refresh ${status.name}`} onClick={() => void client.invalidateQueries({ queryKey: ['octofleet-status', status.id] })}>
        <RefreshCw className="h-4 w-4" />
      </button>
    </header>

    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className={`rounded-full px-2.5 py-1 font-medium ${statusColor}`}>
        <CheckCircle2 className="inline mr-1 h-3 w-3" />{status.connected ? 'Connected' : 'Offline'}
      </span>
      <span className={`rounded-full px-2.5 py-1 ${printing ? 'bg-bambu-green/10 text-bambu-green' : paused ? 'bg-amber-500/10 text-amber-400' : 'bg-bambu-dark-tertiary text-bambu-gray'}`}>
        {status.state || 'Unknown'}
      </span>
      <span className="rounded-full bg-bambu-dark-tertiary px-2.5 py-1 text-bambu-gray">OctoPrint</span>
    </div>

    <section className="space-y-2 min-w-0" aria-label="print status">
      {!compact && <p className="text-[10px] font-semibold tracking-wider text-bambu-gray border-b border-bambu-dark-tertiary pb-1.5">STATUS</p>}
      <div className="rounded-lg bg-bambu-dark p-3 flex gap-3 min-w-0">
        {!compact && <div className="w-20 min-w-20 rounded-lg bg-bambu-dark-tertiary flex items-center justify-center"><FileCode2 className="h-8 w-8 text-bambu-gray"/></div>}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-bambu-gray">{printing ? 'Printing' : paused ? 'Paused' : status.connected ? 'Ready' : 'Not connected'}</p>
          <p className="text-sm font-medium truncate" title={status.filename || undefined}>{status.filename || 'No active print'}</p>
          {(printing || paused) && <>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-bambu-dark-tertiary overflow-hidden">
                <div className="h-full rounded-full bg-bambu-green transition-all" style={{width:`${progress}%`}} />
              </div>
              <span className="text-xs tabular-nums">{progress.toFixed(0)}%</span>
            </div>
            <p className="text-xs text-bambu-gray flex gap-3 flex-wrap">
              <span><Clock3 className="inline h-3 w-3 mr-1" />{clock(status.print_time_seconds)}</span>
              <span>ETA in {clock(status.print_time_left_seconds)}</span>
            </p>
          </>}
        </div>
      </div>
      {status.message && <p className="text-xs text-amber-400" role="status">{status.message}</p>}
    </section>

    {!compact && <>
      <div className="grid grid-cols-2 gap-2">
        {([
          ['Nozzle', status.temperatures?.extruder],
          ['Bed', status.temperatures?.bed],
        ] as const).map(([name, temp]) => <div key={name} className="rounded-lg bg-bambu-dark px-3 py-2 text-center min-w-0">
          <div className="text-[11px] text-bambu-gray"><Thermometer className="inline h-3 w-3 mr-1"/>{name}</div>
          <div className="text-sm font-medium tabular-nums">{temperature(temp?.current)}</div>
          <div className="text-[10px] text-bambu-gray">Target {temperature(temp?.target)}</div>
        </div>)}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-bambu-gray">
        <div className="bg-bambu-dark rounded-md px-3 py-2">Elapsed <span className="text-white float-right tabular-nums">{clock(status.print_time_seconds)}</span></div>
        <div className="bg-bambu-dark rounded-md px-3 py-2">Remaining <span className="text-white float-right tabular-nums">{clock(status.print_time_left_seconds)}</span></div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider text-bambu-gray border-b border-bambu-dark-tertiary pb-1">CONTROLS</div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" disabled={!canControl || !printing || busy} onClick={() => action.mutate('pause')}
            className="rounded-lg px-3 py-2 text-sm bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-30 inline-flex items-center gap-1.5"><Pause className="w-4 h-4"/>Pause</button>
          <button type="button" disabled={!canControl || !paused || busy} onClick={() => action.mutate('resume')}
            className="rounded-lg px-3 py-2 text-sm bg-bambu-green/15 text-bambu-green hover:bg-bambu-green/25 disabled:opacity-30 inline-flex items-center gap-1.5"><Play className="w-4 h-4"/>Resume</button>
          <button type="button" disabled={!canControl || !(printing || paused) || busy} onClick={() => action.mutate('cancel')}
            className="ml-auto rounded-lg px-3 py-2 text-sm bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-30 inline-flex items-center gap-1.5"><XCircle className="w-4 h-4"/>Stop</button>
        </div>
      </div>
    </>}
    <footer className="mt-auto pt-3 border-t border-bambu-dark-tertiary flex items-center gap-2">
      {canCamera && cameraUrl && <button type="button" onClick={() => {setCameraFailed(false);setCameraOpen(true);}}
        title="View workshop camera" aria-label={`Open ${status.name} camera`} className="rounded-lg bg-bambu-dark px-3 py-2 hover:bg-bambu-dark-tertiary text-bambu-gray hover:text-white">
        <Camera className="h-4 w-4"/>
      </button>}
      {canSettings && <Link to="/octoprint" aria-label="OctoPrint settings" title="OctoPrint settings" className="rounded-lg bg-bambu-dark px-3 py-2 hover:bg-bambu-dark-tertiary text-bambu-gray hover:text-white"><Settings2 className="h-4 w-4"/></Link>}
      {status.url?.startsWith('http') && <a href={status.url} target="_blank" rel="noopener noreferrer" title={`Open ${status.name} OctoPrint`} aria-label={`Open ${status.name} OctoPrint`} className="rounded-lg bg-bambu-dark px-3 py-2 hover:bg-bambu-dark-tertiary text-bambu-gray hover:text-white"><ExternalLink className="h-4 w-4"/></a>}
      {canFiles && <button type="button" onClick={() => { setFeedback(''); setFilesOpen(true); }} className="ml-auto rounded-lg bg-bambu-green px-3 py-2 text-sm font-medium text-white hover:brightness-110 inline-flex items-center gap-1.5"><FolderOpen className="h-4 w-4"/>Print</button>}
    </footer>

    {feedback && <p role="status" className="text-xs text-bambu-gray break-words">{feedback}</p>}

    {(cameraOpen || filesOpen) && <div className="fixed inset-0 z-[100] bg-black/75 flex items-center justify-center p-4" onMouseDown={e => { if(e.target===e.currentTarget){setCameraOpen(false);setFilesOpen(false);} }}>
      <div role="dialog" aria-modal="true" aria-label={cameraOpen ? `${status.name} camera` : `${status.name} files`} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-bambu-dark-tertiary bg-bambu-dark-secondary p-4 md:p-5 space-y-4 shadow-2xl">
        <div className="flex justify-between items-center gap-3">
          <h3 className="text-lg font-semibold">{cameraOpen ? `${status.name} · Camera` : `${status.name} · Print files`}</h3>
          <button type="button" aria-label="Close" className="p-2 rounded hover:bg-bambu-dark-tertiary" onClick={() => {setCameraOpen(false);setFilesOpen(false);}}><X className="h-5 w-5"/></button>
        </div>
        {cameraOpen && (cameraFailed ? <div className="aspect-video rounded-lg bg-black flex flex-col items-center justify-center gap-2 text-bambu-gray"><VideoOff className="h-8 w-8"/><p>Camera stream unavailable.</p><a className="text-bambu-green underline" href={liveSrc} rel="noopener noreferrer" target="_blank">Open camera directly</a></div> : <img className="w-full rounded-lg bg-black aspect-video object-contain" src={imageSrc} alt={`${status.name} live camera`} onError={() => setCameraFailed(true)} />)}
        {filesOpen && <div className="space-y-4">
          {files.isLoading && <p className="text-sm text-bambu-gray">Loading OctoPrint files…</p>}
          {files.error && <p role="alert" className="text-red-400 text-sm">{(files.error as Error).message}</p>}
          <label className="text-sm block space-y-2">Choose G-code
            <select value={selected} onChange={e => setSelected(e.target.value)} className="w-full rounded-lg bg-bambu-dark border border-bambu-dark-tertiary px-3 py-2 text-white">
              <option value="">Select a file…</option>
              {files.data?.files.map(file => <option key={file.name} value={file.name}>{file.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => action.mutate('start')} disabled={!canControl || !selected || !status.connected || printing || paused || busy} className="rounded-lg bg-bambu-green text-white px-4 py-2 font-medium disabled:opacity-40 inline-flex items-center gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin"/>}<Play className="h-4 w-4"/>Start print</button>
          <form className="border-t border-bambu-dark-tertiary pt-4 space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); if (uploadFile) upload.mutate(uploadFile); }}>
            <label className="block text-sm space-y-2">Upload G-code to OctoPrint (does not start printing)
              <input type="file" accept=".gcode,.gco,.g" className="block w-full text-sm text-bambu-gray" onChange={e => setUploadFile(e.target.files?.[0] ?? null)}/>
            </label>
            <button type="submit" disabled={!uploadFile || busy} className="rounded-lg bg-bambu-dark-tertiary px-4 py-2 text-sm disabled:opacity-40 inline-flex items-center gap-2"><Upload className="h-4 w-4"/>Upload only</button>
          </form>
          {feedback && <p role="status" className="text-sm text-bambu-gray">{feedback}</p>}
          <p className="text-xs text-bambu-gray">OctoPrint-managed jobs only. Verify printer safety before starting a print.</p>
        </div>}
      </div>
    </div>}
  </article>;
}