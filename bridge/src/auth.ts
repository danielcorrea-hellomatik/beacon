import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const TOKEN_PATH = process.env.BEACON_TOKEN_PATH || join( homedir(), '.beacon', 'token' );

export function load_or_create_token(): string {
  if( existsSync( TOKEN_PATH ) )
    return readFileSync( TOKEN_PATH, 'utf8' ).trim();

  mkdirSync( dirname( TOKEN_PATH ), { recursive: true } );
  const token = randomBytes( 24 ).toString( 'base64url' );
  writeFileSync( TOKEN_PATH, token, { mode: 0o600 } );
  return token;
}

export function get_token_path(): string {
  return TOKEN_PATH;
}
