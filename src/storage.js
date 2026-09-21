/* localStorage. Every read is defensive — private windows, cleared site data
 * and quota errors all have to leave the instrument playable. */

const CAL_KEY   = 'handspace.calib.v1';
const TAKES_KEY = 'handspace.takes.v1';
const MAX_TAKES = 12;

function read(key, fallback){
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_){ return fallback; }
}
function write(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (_){ return false; }
}

/* ───────── calibration ───────── */

export function loadCalibration(){
  const c = read(CAL_KEY, null);
  if (!c || typeof c.near !== 'number' || typeof c.far !== 'number') return null;
  return c.near > c.far ? c : null;
}
export function saveCalibration(c){ return write(CAL_KEY, { ...c, ts: Date.now() }); }
export function clearCalibration(){ try { localStorage.removeItem(CAL_KEY); } catch (_){} }

/* ───────── takes ───────── */

export function listTakes(){
  const t = read(TAKES_KEY, []);
  return Array.isArray(t) ? t : [];
}

export function saveTake(name, kitId, data){
  const takes = listTakes();
  takes.unshift({ id: `t${Date.now()}`, name, kit: kitId, ts: Date.now(), data });
  // Oldest takes fall off rather than letting a full quota block the save.
  while (takes.length > MAX_TAKES) takes.pop();
  return write(TAKES_KEY, takes) ? takes : null;
}

export function deleteTake(id){
  const takes = listTakes().filter(t => t.id !== id);
  write(TAKES_KEY, takes);
  return takes;
}

export function getTake(id){ return listTakes().find(t => t.id === id) ?? null; }
