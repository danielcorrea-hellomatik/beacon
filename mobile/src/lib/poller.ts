/**
 * Pollers para auto-refresh de datos en pantalla.
 * Helpers thin sobre setInterval con cleanup automático.
 */

export function start_poll( fn: () => unknown | Promise<unknown>, ms: number ): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;

  async function tick() {
    if( stopped ) return;
    try { await fn(); } catch {}
    if( !stopped ) timer = setTimeout( tick, ms );
  }

  tick();
  return () => { stopped = true; clearTimeout( timer ); };
}
