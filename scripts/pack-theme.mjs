import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
function varint(n) {
  const bytes = [];
  do { const value = n & 127; n = Math.floor(n / 128); bytes.push(n ? value | 128 : value); } while (n);
  return Buffer.from(bytes);
}
function field(id, bytes) { return Buffer.concat([varint(id * 8 + 2), varint(bytes.length), bytes]); }
function uint32(n) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(n); return bytes; }

const key = crypto.createPrivateKey(await readFile(path.join(root, 'packages/theme-dark.pem')));
const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
const id = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16);
const extensionId = id.toString('hex').replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
if (extensionId !== 'pijpfibjabpbkjfnodppeipagbhableg') throw new Error('Theme signing identity changed.');
const artifacts = path.join(root, '.artifacts');
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(path.join(artifacts, 'theme-pack-'));
try {
  const zip = path.join(temporary, 'theme.zip');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'scripts/compress-theme.ps1'),
    '-SourceDirectory', path.join(root, 'packages/theme-dark'), '-DestinationZip', zip]);
  const archive = await readFile(zip);
  const signedHeader = field(1, id);
  const payload = Buffer.concat([Buffer.from('CRX3 SignedData\0'), uint32(signedHeader.length), signedHeader, archive]);
  const signature = crypto.sign('sha256', payload, key);
  if (!crypto.verify('sha256', payload, crypto.createPublicKey(key), signature)) throw new Error('Signature verification failed.');
  const proof = Buffer.concat([field(1, publicKey), field(2, signature)]);
  const header = Buffer.concat([field(2, proof), field(10000, signedHeader)]);
  await writeFile(path.join(root, 'packages/theme-dark.crx'),
    Buffer.concat([Buffer.from('Cr24'), uint32(3), uint32(header.length), header, archive]));
  console.log(`Theme packaged; existing identity preserved: ${extensionId}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
