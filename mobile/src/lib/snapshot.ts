/**
 * Snapshot share del heatmap.
 * Renderiza el grid 7×24 a un Canvas y exporta como PNG con marca de agua.
 * En Android Tauri usaríamos share intent; en browser descarga directo.
 */

export async function snapshot_heatmap(
  data: number[][],
  opts: { title?: string; subtitle?: string } = {}
): Promise<Blob> {
  const cell = 18;
  const gap  = 3;
  const pad  = 24;
  const day_label_w = 18;
  const hour_label_h = 14;
  const W = pad * 2 + day_label_w + 24 * cell + 23 * gap;
  const H = pad * 2 + hour_label_h + 7 * cell + 6 * gap + 60;   // 60 reservado para footer

  const canvas = document.createElement( 'canvas' );
  canvas.width = W * 2;     // 2x para retina
  canvas.height = H * 2;
  const ctx = canvas.getContext( '2d' )!;
  ctx.scale( 2, 2 );

  // Background
  ctx.fillStyle = '#0E0E10';
  ctx.fillRect( 0, 0, W, H );

  // Title
  ctx.fillStyle = '#F2F2F4';
  ctx.font = 'bold 16px -apple-system, system-ui, sans-serif';
  ctx.fillText( opts.title ?? 'Beacon · Actividad', pad, pad + 4 );

  if( opts.subtitle )
  {
    ctx.fillStyle = '#A8A8AE';
    ctx.font = '11px -apple-system, system-ui';
    ctx.fillText( opts.subtitle, pad, pad + 22 );
  }

  // Max para escalar color
  let max_val = 0;
  for( const row of data ) for( const v of row ) if( v > max_val ) max_val = v;
  max_val = max_val || 1;

  const grid_top  = pad + 40;
  const grid_left = pad + day_label_w;

  // Hour labels
  const days = [ 'D', 'L', 'M', 'X', 'J', 'V', 'S' ];
  ctx.fillStyle = '#6E6E76';
  ctx.font = '9px -apple-system, monospace';
  for( let h = 0; h < 24; h++ )
  {
    if( h % 6 === 0 )
      ctx.fillText( String( h ), grid_left + h * ( cell + gap ), grid_top + hour_label_h - 4 );
  }

  // Day labels + cells
  for( let dow = 0; dow < 7; dow++ )
  {
    ctx.fillStyle = '#6E6E76';
    ctx.font = '10px -apple-system';
    ctx.fillText( days[ dow ], pad, grid_top + hour_label_h + dow * ( cell + gap ) + cell - 4 );

    for( let h = 0; h < 24; h++ )
    {
      const v = data[ dow ]?.[ h ] ?? 0;
      if( v === 0 )
        ctx.fillStyle = '#1E1E22';
      else
      {
        const intensity = Math.min( 1, v / max_val );
        const lum = 25 + intensity * 35;
        ctx.fillStyle = `hsl(16, 60%, ${lum}%)`;
      }
      ctx.fillRect(
        grid_left + h * ( cell + gap ),
        grid_top + hour_label_h + dow * ( cell + gap ),
        cell,
        cell
      );
    }
  }

  // Footer / watermark
  ctx.fillStyle = '#D97757';
  ctx.font = 'bold 11px -apple-system';
  ctx.fillText( '🦀 Beacon', pad, H - pad );
  ctx.fillStyle = '#6E6E76';
  ctx.font = '10px -apple-system';
  ctx.fillText( new Date().toLocaleDateString( 'es-ES' ), W - pad - 60, H - pad );

  return new Promise( ( resolve ) => {
    canvas.toBlob( ( b ) => resolve( b! ), 'image/png' );
  } );
}

export async function share_heatmap_snapshot( data: number[][], opts: { title?: string; subtitle?: string } = {} ): Promise<boolean> {
  const blob = await snapshot_heatmap( data, opts );

  // Tauri Android: TODO usar share intent (requiere plugin de share, dejamos download como fallback)
  if( navigator.share && 'canShare' in navigator )
  {
    try
    {
      const file = new File( [ blob ], 'beacon-heatmap.png', { type: 'image/png' } );
      const data_share: ShareData = { files: [ file ], title: 'Beacon · Mi actividad' };
      if( navigator.canShare( data_share ) )
      {
        await navigator.share( data_share );
        return true;
      }
    }
    catch
    { /* fallthrough a download */ }
  }

  // Fallback: download
  const url = URL.createObjectURL( blob );
  const a = document.createElement( 'a' );
  a.href = url;
  a.download = 'beacon-heatmap.png';
  document.body.appendChild( a );
  a.click();
  a.remove();
  setTimeout( () => URL.revokeObjectURL( url ), 1_000 );
  return true;
}
