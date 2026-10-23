import { useEffect, useState } from 'react';
import { VideoOff } from 'lucide-react';
import { octoCameraUrl, type OctoFleetStatus } from '../api/octoprintFleet';
import type { CameraTileMode, CameraTileStatusMode } from './CameraTile';

export function OctoPrintCameraWallTile({ status, mode, statusMode, snapshotIntervalMs }: {
  status: OctoFleetStatus;
  mode: CameraTileMode;
  statusMode: CameraTileStatusMode;
  snapshotIntervalMs: number;
}) {
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const cameraUrl = octoCameraUrl(status.id);
  const snapshotUrl = cameraUrl;
  const isSnapshot = status.camera?.camera_mode === 'snapshot';
  useEffect(() => {
    setFailed(false);
  }, [cameraUrl, snapshotUrl, mode]);
  useEffect(() => {
    if (mode !== 'snapshot' && !(mode === 'live' && status.camera?.camera_mode === 'snapshot')) return;
    const id = window.setInterval(() => setTick(n => n + 1), snapshotIntervalMs);
    return () => window.clearInterval(id);
  }, [mode, snapshotIntervalMs, status.camera?.camera_mode]);
  const src = isSnapshot ? (snapshotUrl || cameraUrl) : cameraUrl;
  const liveSrc = isSnapshot ? `${src}${src.includes('?') ? '&' : '?'}_=${tick}` : src;
  const state = String(status.state || '').toLowerCase();
  const printing = state.includes('printing');
  const paused = state.includes('paused');
  const progress = Math.max(0, Math.min(100, status.progress_percent ?? 0));
  return <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-bambu-dark-tertiary bg-black">
    {mode === 'paused' || failed ? <div className="absolute inset-0 flex flex-col gap-2 items-center justify-center bg-bambu-dark text-bambu-gray text-xs">
      <VideoOff className="h-7 w-7"/>{failed ? 'Camera unavailable' : 'Camera paused (live stream limit)'}
    </div> : <img src={liveSrc} onError={() => setFailed(true)} className="h-full w-full object-contain" alt="OctoPrint camera" />}
    {statusMode !== 'off' && (printing || paused) && <span className="absolute left-2 top-2 rounded bg-bambu-green/90 px-2 py-0.5 text-[10px] font-semibold text-black uppercase">{paused ? 'Paused' : 'Printing'}{statusMode === 'full' ? ` · ${progress.toFixed(0)}%` : ''}</span>}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pt-8 pb-2 text-xs text-white">
      <p className="font-semibold truncate">{status.name || 'OctoPrint'}</p>
      {statusMode === 'full' && status.filename && (printing || paused) && <p className="text-[11px] text-bambu-gray truncate">{status.filename}</p>}
    </div>
    <span className="absolute right-2 top-2 rounded bg-black/70 text-[10px] px-1.5 py-0.5 text-white">{mode === 'paused' ? 'OFF' : isSnapshot ? 'SNAP' : 'LIVE'}</span>
  </div>;
}