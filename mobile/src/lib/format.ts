export function relative_time( ts: number ): string {
  const diff = Date.now() - ts;
  const s = Math.floor( diff / 1000 );
  if( s < 60 )    return `${s}s`;
  const m = Math.floor( s / 60 );
  if( m < 60 )    return `${m}m`;
  const h = Math.floor( m / 60 );
  if( h < 24 )    return `${h}h`;
  const d = Math.floor( h / 24 );
  if( d < 30 )    return `${d}d`;
  return new Date( ts ).toLocaleDateString();
}

export function compact_number( n: number ): string {
  if( n >= 1_000_000_000 ) return ( n / 1_000_000_000 ).toFixed( 1 ).replace( '.0', '' ) + 'B';
  if( n >= 1_000_000 )     return ( n / 1_000_000 ).toFixed( 1 ).replace( '.0', '' ) + 'M';
  if( n >= 1_000 )         return ( n / 1_000 ).toFixed( 1 ).replace( '.0', '' ) + 'K';
  return String( n );
}

export function short_path( cwd: string ): string {
  const parts = cwd.split( '/' ).filter( Boolean );
  if( parts.length <= 2 ) return cwd;
  return parts.slice( -2 ).join( '/' );
}
