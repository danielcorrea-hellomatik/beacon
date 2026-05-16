/**
 * Voice-to-prompt usando Web Speech API.
 * Funciona en Chrome/WebView Android (Tauri usa Chromium nativo en mobile).
 * En iOS Safari está disponible pero limitado — irrelevante porque sólo soportamos Android.
 *
 * API:
 *   const v = create_voice({ lang: 'es-ES' });
 *   v.start( ( partial, final ) => { ... } );
 *   v.stop();
 */

type SpeechRecognitionEvent = {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognition = {
  lang:             string;
  interimResults:   boolean;
  continuous:       boolean;
  onresult:         ( ev: SpeechRecognitionEvent ) => void;
  onerror:          ( ev: { error: string } ) => void;
  onend:            () => void;
  start():          void;
  stop():           void;
  abort():          void;
};

type SpeechRecognitionCtor = new () => SpeechRecognition;

function get_ctor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?:       SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceController = {
  supported:  boolean;
  start:      ( on_result: ( partial: string, is_final: boolean ) => void ) => void;
  stop:       () => void;
  active:     () => boolean;
};

export function create_voice( opts: { lang?: string } = {} ): VoiceController {
  const Ctor = get_ctor();
  if( !Ctor )
  {
    return {
      supported: false,
      start: () => { console.warn( '[beacon] SpeechRecognition no soportado' ); },
      stop:  () => {},
      active: () => false
    };
  }

  let rec: SpeechRecognition | null = null;
  let running = false;

  return {
    supported: true,
    start( on_result ) {
      if( running ) return;
      rec = new Ctor();
      rec.lang = opts.lang ?? 'es-ES';
      rec.interimResults = true;
      rec.continuous = true;

      let final_buf = '';

      rec.onresult = ( ev ) => {
        let interim = '';
        for( let i = 0; i < ev.results.length; i++ )
        {
          const r = ev.results[ i ];
          if( r.isFinal ) final_buf += r[ 0 ].transcript + ' ';
          else            interim    += r[ 0 ].transcript;
        }
        on_result( ( final_buf + interim ).trim(), false );
      };
      rec.onerror = ( ev ) => { console.warn( '[beacon] voice error:', ev.error ); running = false; };
      rec.onend   = () => {
        running = false;
        if( final_buf.trim() ) on_result( final_buf.trim(), true );
      };

      rec.start();
      running = true;
    },
    stop() {
      if( rec && running ) { rec.stop(); running = false; }
    },
    active() { return running; }
  };
}
