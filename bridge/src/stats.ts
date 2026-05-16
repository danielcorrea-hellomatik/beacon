import { db } from './db.ts';
import { load_ccusage_raw, peek_ccusage_raw } from './ccusage-loader.ts';

export type CalendarCell = {
  date:   string;
  count:  number;
  cost:   number;
  models: number;
};

export type GlobalStats = {
  sessions_total:  number;
  sessions_active: number;
  messages:        number;
  tokens_in:       number;
  tokens_out:      number;
  active_days:     number;
  current_streak:  number;
  longest_streak:  number;
  peak_hour:       number;
  favorite_model:  string;
  cost_total:      number;
  calendar:        CalendarCell[];
  source:          'mixed' | 'sql-only' | 'loading';
};

export type CcusageStats = {
  source: 'ccusage' | 'fallback';
  totals?: unknown;
  daily?: unknown;
  sessions?: unknown;
};

type CcusageDailyRow = {
  date?:                  string;
  inputTokens?:           number;
  outputTokens?:          number;
  cacheCreationTokens?:   number;
  cacheReadTokens?:       number;
  cost?:                  number;
  totalCost?:             number;
  modelsUsed?:            string[];
  modelBreakdowns?: Array<{
    modelName?:           string;
    inputTokens?:         number;
    outputTokens?:        number;
    cacheCreationTokens?: number;
    cacheReadTokens?:     number;
    cost?:                number;
  }>;
};

type CcusageSessionRow = {
  sessionId?:    string;
  lastActivity?: string;
  cost?:         number;
};

const EMPTY_STATS: GlobalStats = {
  sessions_total:  0,
  sessions_active: 0,
  messages:        0,
  tokens_in:       0,
  tokens_out:      0,
  active_days:     0,
  current_streak:  0,
  longest_streak:  0,
  peak_hour:       12,
  favorite_model:  '',
  cost_total:      0,
  calendar:        [],
  source:          'loading'
};

/**
 * Stats globales sin tocar ccusage (instant). Usadas como respuesta
 * inmediata mientras ccusage está cargando.
 */
export function compute_global_stats_sql_only(): GlobalStats {
  const sessions_total  = ( db.prepare( 'select count(*) c from sessions' ).get() as { c: number } ).c;
  const sessions_active = ( db.prepare( `select count(*) c from sessions where status in ( 'working', 'needs_input' )` ).get() as { c: number } ).c;
  const messages        = ( db.prepare( `select count(*) c from events where type = 'UserPromptSubmit'` ).get() as { c: number } ).c;
  const peak_row = db.prepare( `
    select cast( strftime( '%H', ts / 1000, 'unixepoch', 'localtime' ) as integer ) h, count(*) c
    from events group by h order by c desc limit 1
  ` ).get() as { h: number; c: number } | undefined;
  return {
    ...EMPTY_STATS,
    sessions_total,
    sessions_active,
    messages,
    peak_hour: peak_row?.h ?? 12,
    source: 'sql-only'
  };
}

/**
 * Stats completas. Lee del loader compartido (no parsea JSONL si está cacheado).
 * Si ccusage no está disponible aún devuelve sql-only.
 */
export async function compute_global_stats(): Promise<GlobalStats> {
  const base = compute_global_stats_sql_only();

  const raw = await load_ccusage_raw();
  if( raw.daily.length === 0 ) return base;

  const daily = raw.daily as CcusageDailyRow[];

  const by_date = new Map<string, { count: number; cost: number; models: Set<string> }>();
  const by_model_cost = new Map<string, number>();
  let tokens_in = 0, tokens_out = 0, cost_total = 0;

  for( const row of daily )
  {
    const date = row.date ?? '';
    if( !date ) continue;
    const day_tokens = ( row.inputTokens ?? 0 ) + ( row.outputTokens ?? 0 ) + ( row.cacheReadTokens ?? 0 ) + ( row.cacheCreationTokens ?? 0 );
    const day_cost   = row.cost ?? row.totalCost ?? 0;

    tokens_in  += ( row.inputTokens ?? 0 ) + ( row.cacheReadTokens ?? 0 ) + ( row.cacheCreationTokens ?? 0 );
    tokens_out += ( row.outputTokens ?? 0 );
    cost_total += day_cost;

    const entry = by_date.get( date ) ?? { count: 0, cost: 0, models: new Set<string>() };
    entry.count += day_tokens;
    entry.cost  += day_cost;
    for( const m of row.modelsUsed ?? [] ) entry.models.add( m );
    by_date.set( date, entry );

    for( const m of row.modelBreakdowns ?? [] )
    {
      if( !m.modelName ) continue;
      by_model_cost.set( m.modelName, ( by_model_cost.get( m.modelName ) ?? 0 ) + ( m.cost ?? 0 ) );
    }
  }

  const active_days = by_date.size;
  const favorite_model = [ ...by_model_cost.entries() ]
    .sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ]?.[ 0 ]?.replace( /^claude-/, '' ) ?? '';

  // Calendar desde el primer día con actividad hasta hoy
  const calendar: CalendarCell[] = [];
  const dates = [ ...by_date.keys() ].sort();
  if( dates.length > 0 )
  {
    const start = new Date( dates[ 0 ] + 'T00:00:00' );
    while( start.getDay() !== 1 ) start.setDate( start.getDate() - 1 );

    const today = new Date();
    today.setHours( 0, 0, 0, 0 );

    for( let d = new Date( start ); d <= today; d.setDate( d.getDate() + 1 ) )
    {
      const iso = d.toISOString().slice( 0, 10 );
      const e = by_date.get( iso );
      calendar.push( {
        date:   iso,
        count:  e?.count ?? 0,
        cost:   Number( ( e?.cost ?? 0 ).toFixed( 4 ) ),
        models: e?.models.size ?? 0
      } );
    }
  }

  // Streaks
  let current_streak = 0, longest_streak = 0, run = 0;
  let prev: Date | null = null;
  for( const cell of calendar )
  {
    if( cell.count > 0 )
    {
      const cur = new Date( cell.date + 'T00:00:00' );
      if( prev )
      {
        const diff_d = Math.round( ( cur.getTime() - prev.getTime() ) / 86_400_000 );
        run = diff_d === 1 ? run + 1 : 1;
      }
      else run = 1;
      if( run > longest_streak ) longest_streak = run;
      prev = cur;
    }
  }
  if( prev )
  {
    const today_d = new Date();
    today_d.setHours( 0, 0, 0, 0 );
    const diff_today = Math.round( ( today_d.getTime() - prev.getTime() ) / 86_400_000 );
    if( diff_today <= 1 ) current_streak = run;
  }

  return {
    ...base,
    tokens_in,
    tokens_out,
    active_days,
    current_streak,
    longest_streak,
    favorite_model,
    cost_total: Number( cost_total.toFixed( 2 ) ),
    calendar,
    source: 'mixed'
  };
}

/**
 * Wrapper instant: si ccusage está cacheado lo usa, si no devuelve sql-only.
 * Garantiza respuesta < 50ms siempre.
 */
export function compute_global_stats_instant(): GlobalStats {
  const raw = peek_ccusage_raw();
  if( !raw ) return compute_global_stats_sql_only();
  // Reutiliza la lógica completa pero asegurándose que no awaitee
  // (peek garantiza que load_ccusage_raw va a devolver sincrónicamente)
  return compute_global_stats_with( raw );
}

function compute_global_stats_with( raw: { daily: unknown[]; sessions: unknown[] } ): GlobalStats {
  // Misma lógica que compute_global_stats pero sin await (datos ya cargados)
  const base = compute_global_stats_sql_only();
  const daily = raw.daily as CcusageDailyRow[];
  if( daily.length === 0 ) return base;

  const by_date = new Map<string, { count: number; cost: number; models: Set<string> }>();
  const by_model_cost = new Map<string, number>();
  let tokens_in = 0, tokens_out = 0, cost_total = 0;

  for( const row of daily )
  {
    const date = row.date ?? '';
    if( !date ) continue;
    const day_tokens = ( row.inputTokens ?? 0 ) + ( row.outputTokens ?? 0 ) + ( row.cacheReadTokens ?? 0 ) + ( row.cacheCreationTokens ?? 0 );
    const day_cost   = row.cost ?? row.totalCost ?? 0;
    tokens_in  += ( row.inputTokens ?? 0 ) + ( row.cacheReadTokens ?? 0 ) + ( row.cacheCreationTokens ?? 0 );
    tokens_out += ( row.outputTokens ?? 0 );
    cost_total += day_cost;
    const entry = by_date.get( date ) ?? { count: 0, cost: 0, models: new Set<string>() };
    entry.count += day_tokens;
    entry.cost  += day_cost;
    for( const m of row.modelsUsed ?? [] ) entry.models.add( m );
    by_date.set( date, entry );
    for( const m of row.modelBreakdowns ?? [] )
    {
      if( !m.modelName ) continue;
      by_model_cost.set( m.modelName, ( by_model_cost.get( m.modelName ) ?? 0 ) + ( m.cost ?? 0 ) );
    }
  }

  const active_days = by_date.size;
  const favorite_model = [ ...by_model_cost.entries() ]
    .sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ]?.[ 0 ]?.replace( /^claude-/, '' ) ?? '';

  const calendar: CalendarCell[] = [];
  const dates = [ ...by_date.keys() ].sort();
  if( dates.length > 0 )
  {
    const start = new Date( dates[ 0 ] + 'T00:00:00' );
    while( start.getDay() !== 1 ) start.setDate( start.getDate() - 1 );
    const today = new Date();
    today.setHours( 0, 0, 0, 0 );
    for( let d = new Date( start ); d <= today; d.setDate( d.getDate() + 1 ) )
    {
      const iso = d.toISOString().slice( 0, 10 );
      const e = by_date.get( iso );
      calendar.push( { date: iso, count: e?.count ?? 0, cost: Number( ( e?.cost ?? 0 ).toFixed( 4 ) ), models: e?.models.size ?? 0 } );
    }
  }

  let current_streak = 0, longest_streak = 0, run = 0;
  let prev: Date | null = null;
  for( const cell of calendar )
  {
    if( cell.count > 0 )
    {
      const cur = new Date( cell.date + 'T00:00:00' );
      if( prev )
      {
        const diff_d = Math.round( ( cur.getTime() - prev.getTime() ) / 86_400_000 );
        run = diff_d === 1 ? run + 1 : 1;
      }
      else run = 1;
      if( run > longest_streak ) longest_streak = run;
      prev = cur;
    }
  }
  if( prev )
  {
    const today_d = new Date();
    today_d.setHours( 0, 0, 0, 0 );
    const diff_today = Math.round( ( today_d.getTime() - prev.getTime() ) / 86_400_000 );
    if( diff_today <= 1 ) current_streak = run;
  }

  return { ...base, tokens_in, tokens_out, active_days, current_streak, longest_streak, favorite_model, cost_total: Number( cost_total.toFixed( 2 ) ), calendar, source: 'mixed' };
}

/**
 * Legacy: para compat con código viejo. Recomendado usar compute_global_stats.
 */
export async function load_ccusage_stats(): Promise<CcusageStats> {
  const raw = await load_ccusage_raw();
  if( raw.daily.length === 0 ) return { source: 'fallback' };
  return { source: 'ccusage', daily: raw.daily, sessions: raw.sessions };
}

// ─── Daily by model ────────────────────────────────────────────────────────
export type DailyByModel = {
  date:         string;
  model:        string;
  tokens_in:    number;
  tokens_out:   number;
  cache_read:   number;
  cache_create: number;
  cost_usd:     number;
  sessions:     number;
};

export type DailyBreakdown = {
  source:   'ccusage' | 'fallback' | 'loading';
  days:     DailyByModel[];
  totals: {
    days_count:   number;
    models_count: number;
    cost_total:   number;
    tokens_total: number;
  };
};

const EMPTY_BREAKDOWN: DailyBreakdown = {
  source: 'loading',
  days: [],
  totals: { days_count: 0, models_count: 0, cost_total: 0, tokens_total: 0 }
};

export function load_daily_by_model_instant(): DailyBreakdown {
  const raw = peek_ccusage_raw();
  if( !raw ) return EMPTY_BREAKDOWN;
  return compute_daily_breakdown( raw );
}

export async function load_daily_by_model(): Promise<DailyBreakdown> {
  const raw = await load_ccusage_raw();
  if( raw.daily.length === 0 ) return { source: 'fallback', days: [], totals: { days_count: 0, models_count: 0, cost_total: 0, tokens_total: 0 } };
  return compute_daily_breakdown( raw );
}

function compute_daily_breakdown( raw: { daily: unknown[]; sessions: unknown[] } ): DailyBreakdown {
  const daily    = raw.daily    as CcusageDailyRow[];
  const sessions = raw.sessions as CcusageSessionRow[];

  const sessions_by_date = new Map<string, number>();
  for( const s of sessions )
  {
    if( !s.lastActivity ) continue;
    const d = s.lastActivity.slice( 0, 10 );
    sessions_by_date.set( d, ( sessions_by_date.get( d ) ?? 0 ) + 1 );
  }

  const days: DailyByModel[] = [];
  const days_seen   = new Set<string>();
  const models_seen = new Set<string>();
  let cost_total = 0;
  let tokens_total = 0;

  for( const row of daily )
  {
    const date = row.date ?? '';
    if( !date ) continue;
    const breakdowns = row.modelBreakdowns ?? [];
    const day_sessions = sessions_by_date.get( date ) ?? 0;
    const per_model_sessions = breakdowns.length > 0 ? Math.round( day_sessions / breakdowns.length ) : 0;

    for( const m of breakdowns )
    {
      const r: DailyByModel = {
        date,
        model:        m.modelName ?? 'unknown',
        tokens_in:    m.inputTokens ?? 0,
        tokens_out:   m.outputTokens ?? 0,
        cache_read:   m.cacheReadTokens ?? 0,
        cache_create: m.cacheCreationTokens ?? 0,
        cost_usd:     m.cost ?? 0,
        sessions:     per_model_sessions
      };
      days.push( r );
      days_seen.add( r.date );
      models_seen.add( r.model );
      cost_total   += r.cost_usd;
      tokens_total += r.tokens_in + r.tokens_out + r.cache_read + r.cache_create;
    }
  }

  return {
    source: 'ccusage',
    days,
    totals: {
      days_count:   days_seen.size,
      models_count: models_seen.size,
      cost_total:   Number( cost_total.toFixed( 2 ) ),
      tokens_total
    }
  };
}
