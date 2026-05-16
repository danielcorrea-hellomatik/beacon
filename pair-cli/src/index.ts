#!/usr/bin/env bun
/*
  beacon-pair — imprime un código QR con el "carnet de pareado" del bridge local.
  Se escanea desde la app móvil para añadir este Mac.

  Payload del QR (JSON, base64url):
    {
      "v":     1,
      "host":  "DCV-MacBook-Pro.tail-XXXX.ts.net",
      "port":  7890,
      "token": "<token estático del bridge>",
      "name":  "DCV-MacBook-Pro",
      "fp":    ""                            // pendiente S9 (TLS pinning)
    }

  No requiere que el bridge esté corriendo: lee directamente ~/.beacon/token
  y descubre el hostname de Tailscale con `tailscale status --json`.
*/

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import qrcode from 'qrcode-terminal';

const TOKEN_PATH = process.env.BEACON_TOKEN_PATH || join( homedir(), '.beacon', 'token' );
const PORT = Number( process.env.BEACON_PORT ?? 7890 );

function detect_tailscale_hostname(): string | null {
  const r = spawnSync( 'tailscale', [ 'status', '--json' ], { encoding: 'utf8' } );
  if( r.status !== 0 ) return null;
  try
  {
    const data = JSON.parse( r.stdout ) as { Self?: { DNSName?: string; HostName?: string } };
    const dns = data.Self?.DNSName?.replace( /\.$/, '' );
    return dns ?? data.Self?.HostName ?? null;
  }
  catch
  {
    return null;
  }
}

function main(): void {
  if( !existsSync( TOKEN_PATH ) )
  {
    console.error( `\n✗ No encuentro el token en ${TOKEN_PATH}` );
    console.error( '  Arranca el bridge al menos una vez antes (cd ../bridge && bun run start)\n' );
    process.exit( 1 );
  }

  const token = readFileSync( TOKEN_PATH, 'utf8' ).trim();
  const ts_host = detect_tailscale_hostname();
  const host = ts_host ?? hostname();
  const name = hostname().replace( /\.local$/, '' );

  if( !ts_host )
  {
    console.warn( '\n⚠  Tailscale no detectado o no autenticado.' );
    console.warn( `   Usando hostname local "${host}". Funcionará solo en la misma red Wi-Fi.\n` );
  }

  const payload = {
    v:     1,
    host:  host,
    port:  PORT,
    token: token,
    name:  name,
    fp:    ''
  };

  const json = JSON.stringify( payload );
  const url = 'beacon://pair?p=' + Buffer.from( json, 'utf8' ).toString( 'base64url' );

  console.log( '\nEscanea este QR desde la app Beacon en tu móvil:\n' );
  qrcode.generate( url, { small: true } );

  console.log( '\n── Datos del pareado ──' );
  console.log( '  Host:   ' + host );
  console.log( '  Port:   ' + PORT );
  console.log( '  Name:   ' + name );
  console.log( '  Token:  ' + token.slice( 0, 6 ) + '…' + token.slice( -4 ) );
  console.log( '\n  URL completa:' );
  console.log( '  ' + url + '\n' );

  if( ts_host )
    console.log( '✓ Hostname Tailscale detectado. El móvil podrá conectarse desde cualquier red.\n' );
}

main();
