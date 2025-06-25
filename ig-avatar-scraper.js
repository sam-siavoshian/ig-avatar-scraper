#!/usr/bin/env node
/**
 * ig-avatar-scraper.js
 * -----------------------------------------------------------
 * REUSABLE, LONG-RUNNING Instagram profile-pic downloader.
 *
 *  ✅  Headless-Chrome w/ puppeteer-extra-plugin-stealth
 *  ✅  Persistent progress (resume after crash / Ctrl-C)
 *  ✅  Works with a plain txt | csv | json list of usernames
 *  ✅  Pretty terminal output (spinner + colors)
 *
 *  Usage examples:
 *    node ig-avatar-scraper.js --input users.txt
 *    node ig-avatar-scraper.js --input users.csv --column username
 *    node ig-avatar-scraper.js --input users.json --jsonKey insta
 * ---------------------------------------------------------- */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { argv } from 'node:process';

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import cliSpinners from 'cli-spinners';
import ora from 'ora';
import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

puppeteer.use(StealthPlugin());

/*──────────────────────────── CLI opts ────────────────────────────*/
const cli = yargs(hideBin(process.argv))
  .usage('$0 --input <file> [options]')
  .option('input', { alias:'i', demandOption:true,
    describe:'Path to txt/csv/json containing IG usernames' })
  .option('column', { alias:'c', default:'0',
    describe:'CSV col index (0-based) or header name' })
  .option('jsonKey', { alias:'k',
    describe:'Key to read usernames from when input is JSON' })
  .option('outDir', { alias:'o', default:'pfp',
    describe:'Output directory for downloaded JPEGs' })
  .option('concurrency', { alias:'n', default:6,
    describe:'Tabs running in parallel' })
  .option('maxRetries', { alias:'r', default:2,
    describe:'Retries per username on error' })
  .help().argv;

/*──────────────────────────── Globals ─────────────────────────────*/
const OUT_DIR          = path.resolve(cli.outDir);
const PROGRESS_FILE    = 'progress.json';
const NAV_TIMEOUT_MS   = 25000;
const DOWNLOAD_TIMEOUT = 20000;
const PROTOCOL_TIMEOUT = 60000;
const UA_DESKTOP       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                          'AppleWebKit/537.36 (KHTML, like Gecko) '   +
                          'Chrome/124.0.0.0 Safari/537.36';

/*──────────────────────────── Helpers ─────────────────────────────*/
const ensureDir = p => { if (!fs.existsSync(p)) fs.mkdirSync(p); };

const saveProgress = data =>
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data));

const readProgress = () =>
  fs.existsSync(PROGRESS_FILE) ? JSON.parse(fs.readFileSync(PROGRESS_FILE))
                               : { done:{} };

async function downloadImage(url, dest) {
  const { data:stream } = await axios.get(url, { responseType:'stream',
                                                 timeout:DOWNLOAD_TIMEOUT });
  await new Promise((res,rej)=>
    stream.pipe(fs.createWriteStream(dest)).on('finish',res).on('error',rej));
}

async function parseInput(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file,'utf8').trim();

  if (ext === '.json') {
    const json = JSON.parse(raw);
    if (Array.isArray(json))
      return json.map(e => cli.jsonKey ? e[cli.jsonKey] : e)
                 .filter(Boolean);
    throw new Error('JSON root must be an array');
  }
  if (ext === '.csv') {
    const rows = raw.split(/\r?\n/).filter(Boolean);
    const header = rows[0].split(',');
    const idx = isNaN(+cli.column)
      ? header.indexOf(cli.column)
      : +cli.column;
    if (idx < 0) throw new Error('CSV column not found');
    return rows.slice(1).map(r => r.split(',')[idx].trim()).filter(Boolean);
  }
  // default plain-text
  return raw.split(/\r?\n/).filter(Boolean);
}

/*──────────────────────────── Main ────────────────────────────────*/
(async () => {
  ensureDir(OUT_DIR);
  const spinner = ora({ text:'Booting Chrome…', spinner:cliSpinners.dots });
  spinner.start();

  let usernames = await parseInput(cli.input);
  const progress = readProgress();
  usernames = usernames.filter(u => !progress.done[u]);

  if (!usernames.length) {
    spinner.succeed('Everything already scraped. Nothing to do.');
    process.exit();
  }

  let saved=0, failed=0;

  const browser = await puppeteer.launch({
    headless:'new', protocolTimeout:PROTOCOL_TIMEOUT });

  const queue = [...usernames];
  const workers = Array.from({ length:+cli.concurrency }).map(async () => {
    while (queue.length) {
      const user = queue.shift();
      let tries = 0, ok = false;

      while (tries <= cli.maxRetries && !ok) {
        tries++;
        try {
          const page = await browser.newPage();
          await page.setUserAgent(UA_DESKTOP);
          await page.setRequestInterception(true);
          page.on('request', r => r.resourceType()==='document' ? r.continue():r.abort());
          await page.goto(`https://www.instagram.com/${user}/`,
                          { timeout:NAV_TIMEOUT_MS, waitUntil:'domcontentloaded' });
          let pic = await page.$$eval('meta[property="og:image"]',
                                       els => els[0]?.content);
          if (!pic) {
            const html = await page.content();
            const m = html.match(/"profile_pic_url_hd":"([^"]+)"/);
            if (m) pic = m[1].replace(/\\u0026/g,'&');
          }
          if (!pic) throw Error('pic not found');

          await downloadImage(pic, path.join(OUT_DIR, `${user}.jpg`));
          progress.done[user] = true; saved++;
          spinner.text = chalk.green(`[saved] ${user}   (${saved}/${usernames.length})`);
          ok = true;
          await page.close();
        } catch (e) {
          if (tries>cli.maxRetries) {
            progress.done[user]='failed'; failed++;
            spinner.text = chalk.red(`[fail]  ${user}: ${e.message}`);
          }
        }
        saveProgress(progress);
      }
    }
  });

  await Promise.all(workers);
  spinner.succeed(chalk.bold(`Finished  ✔  saved:${saved}  failed:${failed}`));
  await browser.close();
})();

/*──────── graceful exit — ensure progress always flushed ────────*/
['SIGINT','SIGTERM','unhandledRejection','uncaughtException']
  .forEach(evt => process.on(evt, () => {
    console.log('\nGraceful exit — progress saved.');
    process.exit();
  }));
