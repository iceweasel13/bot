import { register } from 'node:module'

// Register ts-node ESM loader via Node's stable register() API.
// Use this file's URL as the parent URL so Node can resolve the loader specifier.
register('ts-node/esm', import.meta.url)
