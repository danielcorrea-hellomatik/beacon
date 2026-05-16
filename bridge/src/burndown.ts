import { load_ccusage_stats } from './stats.ts';
import { get_config } from './db.ts';

export type Burndown = {
  plan_usd:           number;
  spent_usd:          number;
  days_elapsed:       number;
  days_in_month:      number;
  days_remaining:     number;
  projected_eom_usd:  number;
  daily_avg_usd:      number;
  status:             'safe' | 'on_track' | 'warning' | 'over_budget';
  message:            string;
};

/**
 * Cost burndown estilo "credit card statement": cuánto llevas gastado,
 * cuánto llevas del mes, y proyección lineal de gasto al cierre.
 *
 * Plan mensual se configura via /api/config { plan_usd: 200 }
 * Si no hay plan configurado, devolvemos status 'safe' y plan_usd=0.
 */
export async function compute_burndown(): Promise<Burndown> {
  const plan_usd = Number( get_config( 'plan_usd' ) ?? 0 );

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const days_in_month  = new Date( year, month + 1, 0 ).getDate();
  const days_elapsed   = day;
  const days_remaining = days_in_month - day;

  // Tomamos coste real del mes desde ccusage daily data
  let spent_usd = 0;
  const ccu = await load_ccusage_stats();
  if( ccu.source === 'ccusage' && Array.isArray( ccu.daily ) )
  {
    const month_str = `${year}-${String( month + 1 ).padStart( 2, '0' )}`;
    for( const row of ccu.daily as Array<{ date?: string; cost?: number; totalCost?: number }> )
    {
      const d = row.date ?? '';
      if( d.startsWith( month_str ) )
        spent_usd += Number( row.cost ?? row.totalCost ?? 0 );
    }
  }

  const daily_avg_usd = days_elapsed > 0 ? spent_usd / days_elapsed : 0;
  const projected_eom_usd = daily_avg_usd * days_in_month;

  let status: Burndown['status'] = 'safe';
  let message = '';

  if( plan_usd === 0 )
  {
    status = 'safe';
    message = 'Sin plan configurado. Setea plan_usd en config para activar alertas.';
  }
  else if( spent_usd >= plan_usd )
  {
    status = 'over_budget';
    message = `Ya has gastado $${spent_usd.toFixed( 2 )} de $${plan_usd}. Pasaste el límite.`;
  }
  else if( projected_eom_usd > plan_usd * 1.1 )
  {
    status = 'warning';
    const overshoot = Math.round( ( projected_eom_usd / plan_usd - 1 ) * 100 );
    message = `A este ritmo terminarás el mes en $${projected_eom_usd.toFixed( 0 )} (+${overshoot}% sobre tu plan de $${plan_usd}).`;
  }
  else
  {
    status = 'on_track';
    message = `Gastaste $${spent_usd.toFixed( 2 )} de $${plan_usd}. Proyección fin de mes: $${projected_eom_usd.toFixed( 0 )}.`;
  }

  return {
    plan_usd,
    spent_usd:         Number( spent_usd.toFixed( 2 ) ),
    days_elapsed,
    days_in_month,
    days_remaining,
    projected_eom_usd: Number( projected_eom_usd.toFixed( 2 ) ),
    daily_avg_usd:     Number( daily_avg_usd.toFixed( 2 ) ),
    status,
    message
  };
}
