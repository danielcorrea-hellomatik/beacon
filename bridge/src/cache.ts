/*
  Cache TTL + in-flight dedup + stale-while-revalidate.

  - fresh (< ttl): devuelve cache inmediato
  - stale + cache previo: devuelve previo y dispara refresh en background
  - sin cache previo + nadie está fetcheando: hace el fetch
  - sin cache previo + alguien ya está fetcheando: espera al mismo Promise
*/

type Entry<T> = {
  value:       T;
  fetched_at:  number;
};

const cache    = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key:      string,
  ttl_ms:   number,
  fetcher:  () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const e = cache.get( key ) as Entry<T> | undefined;

  if( e && now - e.fetched_at < ttl_ms ) return e.value;

  if( e )
  {
    // Stale: devolvemos previo y refrescamos en bg si no hay otro fetch en curso
    if( !inflight.has( key ) )
    {
      const p = fetcher().then( v => {
        cache.set( key, { value: v, fetched_at: Date.now() } );
        inflight.delete( key );
        return v;
      } ).catch( err => { inflight.delete( key ); throw err; } );
      inflight.set( key, p );
    }
    return e.value;
  }

  // Sin cache previo
  if( inflight.has( key ) ) return inflight.get( key ) as Promise<T>;

  const p = fetcher().then( v => {
    cache.set( key, { value: v, fetched_at: Date.now() } );
    inflight.delete( key );
    return v;
  } ).catch( err => { inflight.delete( key ); throw err; } );
  inflight.set( key, p );
  return p;
}

/**
 * Set valor en cache sin disparar fetcher. Útil para warmup al boot.
 */
export function prime<T>( key: string, value: T ): void {
  cache.set( key, { value, fetched_at: Date.now() } );
}

/**
 * Devuelve valor del cache si existe (sin importar staleness). null si no.
 */
export function peek<T>( key: string ): T | null {
  const e = cache.get( key ) as Entry<T> | undefined;
  return e?.value ?? null;
}

export function invalidate( key: string ): void {
  cache.delete( key );
}
