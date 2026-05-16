export type SessionStatus = 'working' | 'idle' | 'needs_input' | 'ended' | 'unknown';

export type Device = {
  id:        string;          // hash del token
  host:      string;          // hostname Tailscale
  port:      number;
  token:     string;
  name:      string;
  online:    boolean;
  last_seen: number;
  ntfy_topic?: string;
};

export type Session = {
  id:             string;
  device_id:      string;
  cwd:            string;
  status:         SessionStatus;
  model:          string;
  channel:        string;
  started_at:     number;
  last_event_at:  number;
  ended_at:       number | null;
  prompt_first:   string;
  tokens_in:      number;
  tokens_out:     number;
  events_count:   number;
};

export type SessionEvent = {
  id:           number;
  session_id:   string;
  ts:           number;
  type:         string;
  tool_name:    string;
  payload_json: string;
};

export type CalendarCell = {
  date:   string;          // YYYY-MM-DD
  count:  number;          // tokens totales del día
  cost:   number;          // USD
  models: number;          // modelos distintos
};

export type DeviceStats = {
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
