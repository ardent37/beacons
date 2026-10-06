// Lo ejecuta la GitHub Action cada 30 min: actualiza data/followers.json
// con la suma de seguidores de TikTok + Instagram.
import { readFile, writeFile } from 'node:fs/promises';
import { getFollowers } from '../api/worker.js';

const file = new URL('../data/followers.json', import.meta.url);
const previous = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));

const data = await getFollowers(previous);
if (data.errors.length) console.warn('Avisos:', data.errors.join(' | '));

if (data.total === previous.total) {
  console.log(`Sin cambios (${data.total}).`);
} else {
  const { errors, ...clean } = data;
  await writeFile(file, JSON.stringify(clean, null, 2) + '\n');
  console.log(`Seguidores: ${previous.total ?? '—'} → ${data.total}`);
}
