import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Settings2, Trash2, Pencil, ArrowLeft, Printer, Camera, Save, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { klipperFleetFetch, type KlipperFleetConfig, type KlipperFleetInput } from '../api/klipperFleet';

const blank: KlipperFleetInput = {name:'',url:'',api_key:'',camera_url:'',snapshot_url:'',camera_mode:'mjpeg'};
const field = 'mt-1 w-full rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-3 py-2 text-white focus:border-bambu-green focus:outline-none';

export function KlipperManager({ embedded = false }: { embedded?: boolean } = {}) {
  const { authEnabled, hasPermission } = useAuth();
  const canRead = !authEnabled || hasPermission('settings:read');
  const canEdit = !authEnabled || hasPermission('settings:update');
  const qc = useQueryClient();
  const query = useQuery({queryKey:['klipperfleet-printers'],queryFn:()=>klipperFleetFetch<KlipperFleetConfig[]>('/printers'),enabled:canRead});
  const [editing, setEditing] = useState<string|null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<KlipperFleetInput>(blank);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const save = useMutation({
    mutationFn: () => klipperFleetFetch<KlipperFleetConfig>(editing ? `/printers/${encodeURIComponent(editing)}` : '/printers',{
      method: editing ? 'PATCH' : 'POST',body:JSON.stringify(form),
    }),
    onSuccess: () => {setError('');setSuccess(editing ? 'Printer updated' : 'Printer added');setOpen(false);setEditing(null);setForm(blank);void qc.invalidateQueries({queryKey:['klipperfleet-printers']});},
    onError: (e:Error)=>setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id:string)=>klipperFleetFetch<void>(`/printers/${encodeURIComponent(id)}`,{method:'DELETE'}),
    onSuccess: ()=>{setError('');setSuccess('Connection removed');void qc.invalidateQueries({queryKey:['klipperfleet-printers']});},
    onError:(e:Error)=>setError(e.message),
  });
  useEffect(()=>{if (embedded) return;document.title='Klipper - Bambuddy';return ()=>{document.title='Bambuddy';};},[embedded]);
  if (!canRead) return <p className="p-8 text-bambu-gray">You do not have permission to view Klipper settings.</p>;
  function edit(p:KlipperFleetConfig){setEditing(p.id);setForm({name:p.name,url:p.url,api_key:'',camera_url:p.camera_url||'',snapshot_url:p.snapshot_url||'',camera_mode:p.camera_mode});setError('');setOpen(true);}
  function add(){setEditing(null);setForm(blank);setError('');setOpen(true);}
  function onSubmit(event: FormEvent<HTMLFormElement>){event.preventDefault();save.mutate();}
  return <main className={embedded ? "space-y-6" : "mx-auto max-w-5xl p-4 md:p-8 space-y-6"}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        {!embedded && <Link to="/" className="text-sm text-bambu-gray hover:text-white inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4"/>Printers</Link>}
        <h1 className="text-2xl font-bold text-white flex items-center gap-3"><Settings2 className="h-6 w-6 text-bambu-green"/>Klipper</h1>
        <p className="text-sm text-bambu-gray">Manage each Klipper printer and its individual IP-camera feed.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/klipper-legacy" className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-3 py-2 text-sm text-bambu-gray hover:text-white">Existing Moonraker plugin</Link>
        {canEdit && <button onClick={add} className="inline-flex items-center gap-2 rounded-lg bg-bambu-green px-4 py-2 font-semibold text-white"><Plus className="h-4 w-4"/>Add Klipper printer</button>}
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-red-400">{error}</p>}
    {success && <p role="status" className="text-bambu-green">{success}</p>}
    {query.isLoading && <p className="text-bambu-gray">Loading connections…</p>}
    {query.error && <p className="text-red-400">{(query.error as Error).message}</p>}
    {!query.isLoading && query.data?.length === 0 && <div className="rounded-xl border border-dashed border-bambu-dark-tertiary bg-bambu-dark-secondary px-5 py-10 text-center space-y-2">
      <Printer className="mx-auto h-9 w-9 text-bambu-gray"/>
      <p className="font-semibold">No Klipper printers configured</p>
      <p className="text-sm text-bambu-gray">Use Add Klipper printer to connect your first machine. Legacy Moonraker plugin connections are preserved separately; add them here to enable stock-style cards.</p>
    </div>}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {query.data?.map(p => <article key={p.id} className="rounded-xl border border-bambu-dark-tertiary bg-bambu-dark-secondary p-5 space-y-3">
        <h2 className="font-semibold text-lg text-white">{p.name}</h2>
        <p className="text-sm text-bambu-gray break-all">{p.url}</p>
        <p className="flex gap-2 items-center text-xs text-bambu-gray"><Camera className="h-4 w-4"/>{p.camera_url ? 'Camera configured' : 'No camera'} · {p.has_api_key ? 'API key saved' : 'No API key'}</p>
        {canEdit && <div className="flex gap-2 pt-2 border-t border-bambu-dark-tertiary">
          <button onClick={()=>edit(p)} className="inline-flex items-center gap-2 rounded-lg bg-bambu-dark px-3 py-2 text-sm text-white"><Pencil className="h-4 w-4"/>Edit</button>
          <button disabled={remove.isPending} onClick={()=>{if(window.confirm(`Remove ${p.name} from Bambuddy? This will not delete anything from Klipper.`)) remove.mutate(p.id);}} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400"><Trash2 className="h-4 w-4"/>Remove</button>
        </div>}
      </article>)}
    </div>
    {open && <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/75 p-4 flex items-start justify-center sm:items-center" onMouseDown={e=>{if(e.target===e.currentTarget && !save.isPending)setOpen(false);}}>
      <form onSubmit={onSubmit} role="dialog" aria-modal="true" aria-label="Klipper printer settings" className="w-full max-w-xl rounded-xl border border-bambu-dark-tertiary bg-bambu-dark-secondary p-5 space-y-4 text-white">
        <div className="flex justify-between items-center"><h2 className="text-lg font-semibold">{editing ? 'Edit Klipper printer' : 'Add Klipper printer'}</h2><button type="button" aria-label="Close" onClick={()=>setOpen(false)}><X className="h-5 w-5"/></button></div>
        <label className="block text-sm">Printer name<input className={field} value={form.name} maxLength={100} required placeholder="My Klipper Printer" onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label className="block text-sm">Klipper URL<input className={field} type="url" value={form.url} required placeholder="http://192.168.0.100:7125" onChange={e=>setForm({...form,url:e.target.value})}/></label>
        <label className="block text-sm">Klipper API key<input className={field} type="password" autoComplete="new-password" value={form.api_key} placeholder={editing ? 'Leave blank to keep existing key' : 'Paste Moonraker API key (if authorization is enabled)'} onChange={e=>setForm({...form,api_key:e.target.value})}/></label>
        <div className="border-t border-bambu-dark-tertiary pt-4 space-y-3">
          <h3 className="font-medium flex gap-2 items-center"><Camera className="h-4 w-4"/>Camera settings</h3>
          <label className="block text-sm">Camera stream URL<input className={field} type="url" value={form.camera_url} placeholder="http://192.168.0.100:8080/video" onChange={e=>setForm({...form,camera_url:e.target.value})}/></label>
          <label className="block text-sm">Snapshot URL (optional)<input className={field} type="url" value={form.snapshot_url} placeholder="http://192.168.0.100:8081/photo.jpg" onChange={e=>setForm({...form,snapshot_url:e.target.value})}/></label>
          <label className="block text-sm">Camera type<select className={field} value={form.camera_mode} onChange={e=>setForm({...form,camera_mode:e.target.value as KlipperFleetInput['camera_mode']})}><option value="mjpeg">MJPEG live stream</option><option value="snapshot">JPEG snapshot</option></select></label>
        </div>
        <p className="text-xs text-bambu-gray">Connect using a private LAN IP address. API keys are stored on the server, not in the browser. Camera URL is proxied through Bambuddy.</p>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2"><button className="px-4 py-2 rounded-lg bg-bambu-dark-tertiary" type="button" onClick={()=>setOpen(false)}>Cancel</button><button className="px-4 py-2 rounded-lg bg-bambu-green inline-flex items-center gap-2" disabled={save.isPending} type="submit"><Save className="h-4 w-4"/>{save.isPending ? 'Saving…' : 'Save printer'}</button></div>
      </form>
    </div>}
  </main>;
}