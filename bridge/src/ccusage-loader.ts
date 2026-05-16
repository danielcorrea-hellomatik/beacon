/*
  Loader compartido de ccusage. Es la única forma de tocar el data-loader
  desde el resto del bridge — garantiza que sólo parseamos los JSONL UNA vez
  por TTL aunque varios callers pidan stats en paralelo (stats locales,
  daily-by-model, burndown).

  Las 3 callers downstream (compute_global_stats, load_daily_by_model,
  compute_burndown) reutilizan los mismos arrays daily/sessions sin re-parsear.
*/

let cached: { daily: unknown[]; sessions: unknown[]; loaded_at: number } | null = null;
let in_flight: Promise<{ daily: unknown[]; sessions: unknown[] }> | null = null;

const TTL_MS = 60_000;

export async function load_ccusage_raw(): Promise<{ daily: unknown[]; sessions: unknown[] }> {
  const now = Date.now();
  if( cached && now - cached.loaded_at < TTL_MS )
    return { daily: cached.daily, sessions: cached.sessions };

  if( in_flight ) return in_flight;

  in_flight = ( async () => {
    try
    {
      const mod = await import( 'ccusage/data-loader' );
      const [ daily, sessions ] = await Promise.all( [
        mod.loadDailyUsageData( { mode: 'calculate' } as never ),
        mod.loadSessionData( { mode: 'calculate' } as never )
      ] );
      cached = { daily: daily as unknown[], sessions: sessions as unknown[], loaded_at: Date.now() };
      return { daily: cached.daily, sessions: cached.sessions };
    }
    catch
    {
      return { daily: [], sessions: [] };
    }
    finally
    {
      in_flight = null;
    }
  } )();

  return in_flight;
}

export function peek_ccusage_raw(): { daily: unknown[]; sessions: unknown[] } | null {
  return cached ? { daily: cached.daily, sessions: cached.sessions } : null;
}
