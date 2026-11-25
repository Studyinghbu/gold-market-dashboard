import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { marketResponse } from './api.mjs';

const publicDir = new URL('../public/', import.meta.url);
const dataDir = new URL('data/', publicDir);
const seed = JSON.parse(await readFile(new URL('snapshot.json', publicDir), 'utf8'));
const groups = ['market', 'minute', 'daily', 'rate'];
const publishedUrl = process.env.PAGES_URL;

async function previous(group) {
  if (!publishedUrl) return {};
  const url = new URL('data/' + group + '.json', publishedUrl.replace(/\/?$/, '/'));
  url.searchParams.set('run', process.env.GITHUB_RUN_ID || String(Date.now()));
  const response = await fetch(url, {signal: AbortSignal.timeout(15000)});
  if (response.status === 404) return {};
  if (!response.ok) throw Error('Cannot read previous deployment: ' + response.status);
  return (await response.json()).records;
}

function timestamp(record) {
  return record?.asof || record?.points?.at(-1)?.[0] || '';
}

async function collect(group) {
  const [prior, response] = await Promise.all([
    previous(group),
    marketResponse(new Request('https://localhost/api/market?group=' + group))
  ]);
  const latest = await response.json();
  const records = {...seed[group]};
  const valid = [];
  for (const source of [prior, latest.records]) {
    for (const [key, record] of Object.entries(source)) {
      if (timestamp(record) && timestamp(record) >= timestamp(records[key])) {
        records[key] = record;
        if (source === latest.records && latest.valid.includes(key)) valid.push(key);
      }
    }
  }
  await writeFile(new URL(group + '.json', dataDir), JSON.stringify({records, valid, checked: latest.checked}));
  console.log(group, valid.length, 'updated,', Object.keys(records).length, 'available');
}

await mkdir(dataDir, {recursive: true});
await Promise.all(groups.map(collect));
