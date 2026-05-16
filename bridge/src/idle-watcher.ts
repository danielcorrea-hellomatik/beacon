import { db } from './db.ts';
import { push } from './ntfy.ts';

const IDLE_THRESHOLD_MS = Number( process.env.BEACON_IDLE_MS ?? 60_000 );
const CHECK_INTERVAL_MS = 15_000;

type IdleCandidate = {
  id: string;
  cwd: string;
  last_event_at: number;
  status: string;
};

const alerted = new Set<string>();

export function start_idle_watcher(): NodeJS.Timeout {
  return setInterval( async () => {
    const now = Date.now();
    const threshold = now - IDLE_THRESHOLD_MS;

    const stuck = db.prepare( `
      select id, cwd, last_event_at, status
      from sessions
      where status = 'working' and last_event_at < ?
    ` ).all( threshold ) as IdleCandidate[];

    for( const s of stuck )
    {
      if( alerted.has( s.id ) ) continue;
      alerted.add( s.id );
      const secs = Math.round( ( now - s.last_event_at ) / 1000 );
      await push(
        s.id,
        'idle',
        'Claude parece bloqueado',
        `${s.cwd}\nSin actividad desde hace ${secs}s.`
      );
    }

    // Resetear alerted para sesiones que ya no están working
    const active = db.prepare( `select id from sessions where status = 'working'` ).all() as Array<{ id: string }>;
    const active_ids = new Set( active.map( a => a.id ) );
    for( const id of alerted )
    {
      if( !active_ids.has( id ) ) alerted.delete( id );
    }
  }, CHECK_INTERVAL_MS );
}
