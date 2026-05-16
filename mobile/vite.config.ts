import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const host = process.env.TAURI_DEV_HOST;

// Default device pre-configurado en compile time. Se inyecta como
// __BEACON_DEFAULT__ en el bundle. El frontend lo lee y, si está
// poblado, auto-añade el device en el primer arranque.
const BEACON_DEFAULT = {
  host:  process.env.BEACON_DEFAULT_HOST  ?? '',
  port:  Number( process.env.BEACON_DEFAULT_PORT ?? 7890 ),
  token: process.env.BEACON_DEFAULT_TOKEN ?? '',
  name:  process.env.BEACON_DEFAULT_NAME  ?? ''
};

export default defineConfig( {
  plugins: [ svelte() ],
  clearScreen: false,
  define: {
    __BEACON_DEFAULT__: JSON.stringify( BEACON_DEFAULT )
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: [ '**/src-tauri/**' ] }
  }
} );
