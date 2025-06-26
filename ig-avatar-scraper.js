#!/usr/bin/env node
/**
 * ig-avatar-scraper.js
 * --------------------------------------------------------------------------
 *  ⚡  Fast path: Instagram authenticated session
 *  🕵️  Fallback: Stealth headless-Chrome (Puppeteer Extra)
 *  💾  Crash-proof: progress.json updated after EVERY username
 *  🔄  UA rotation + browser recycle to dodge soft-rate-limits
 *  🎛  Works with txt | csv | json input, fully configurable CLI
 *
 *  Examples
 *  --------
 *    node ig-avatar-scraper.js -i users.txt
 *    node ig-avatar-scraper.js -i members.csv -c insta
 *    node ig-avatar-scraper.js -i list.json   -k ig -n 10
 * -------------------------------------------------------------------------*/

import fs               from 'node:fs';
import path             from 'node:path';
import process          from 'node:process';
import { fileURLToPath } from 'node:url';
import readline         from 'node:readline';

import puppeteer        from 'puppeteer-extra';
import StealthPlugin    from 'puppeteer-extra-plugin-stealth';
import axios            from 'axios';
import cliSpinners      from 'cli-spinners';
import ora              from 'ora';
import chalk            from 'chalk';
import yargs            from 'yargs';
import { hideBin }      from 'yargs/helpers';

puppeteer.use(StealthPlugin());

/* ── CLI OPTIONS ────────────────────────────────────────────────────────── */
const cli = yargs(hideBin(process.argv))
  .usage('$0 --input <file> [options]')
  .option('input',  { alias:'i', demandOption:true,
    describe:'txt / csv / json file containing IG usernames' })
  .option('column', { alias:'c', default:'0',
    describe:'CSV column index (0-based) OR header name' })
  .option('jsonKey',{ alias:'k',
    describe:'Key to read usernames from when input is JSON' })
  .option('outDir', { alias:'o', default:'pfp',
    describe:'Output directory for downloaded .jpg files' })
  .option('concurrency',{ alias:'n', default:3,
    describe:'Parallel Chrome tabs' })
  .option('maxRetries', { alias:'r', default:3,
    describe:'Retries per username before marking failed' })
  .option('username', { alias:'u',
    describe:'Instagram username for authentication' })
  .option('password', { alias:'p',
    describe:'Instagram password for authentication' })
  .option('cookiesFile', { default:'ig_cookies.json',
    describe:'File to store/load Instagram cookies' })
  .option('noAuth', { type:'boolean', default:false,
    describe:'Skip authentication (limited functionality)' })
  .help()
  .argv;

/* ── CONSTANTS ─────────────────────────────────────────────────────────── */
const OUT_DIR              = path.resolve(cli.outDir);
const PROGRESS_FILE        = 'progress.json';
const COOKIES_FILE         = cli.cookiesFile;
const NAV_TIMEOUT_MS       = 30_000;
const DOWNLOAD_TIMEOUT_MS  = 20_000;
const PROTOCOL_TIMEOUT_MS  = 60_000;
const TABS_BEFORE_RELAUNCH = 50;
const LOGIN_URL            = 'https://www.instagram.com/accounts/login/';
const PROFILE_BASE_URL     = 'https://www.instagram.com/';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
];

/* ── HELPERS ───────────────────────────────────────────────────────────── */
const ensureDir = p => { if (!fs.existsSync(p)) fs.mkdirSync(p); };

const readProgress = () =>
  fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    : { done:{} , stats:{saved:0,failed:0} };

const saveProgress = p =>
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 0));

const readCookies = () => 
  fs.existsSync(COOKIES_FILE)
    ? JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'))
    : null;

const saveCookies = cookies =>
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));

async function download(url, dest) {
  const { data:stream } = await axios.get(url, {
    responseType:'stream', timeout:DOWNLOAD_TIMEOUT_MS });
  await new Promise((res,rej)=>
    stream.pipe(fs.createWriteStream(dest))
          .on('finish',res).on('error',rej));
}

async function parseInput(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file,'utf8').trim();

  if (ext === '.json') {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw Error('JSON root must be an array');
    return arr.map(o => cli.jsonKey ? o[cli.jsonKey] : o).filter(Boolean);
  }
  if (ext === '.csv') {
    const rows = raw.split(/\r?\n/).filter(Boolean);
    const header = rows[0].split(',');
    const idx = isNaN(+cli.column) ? header.indexOf(cli.column) : +cli.column;
    if (idx < 0) throw Error('CSV column not found');
    return rows.slice(1).map(r => r.split(',')[idx].trim()).filter(Boolean);
  }
  // txt
  return raw.split(/\r?\n/).filter(Boolean);
}

// Function to prompt for credentials if not provided
async function promptCredentials() {
  if (cli.username && cli.password) {
    return { username: cli.username, password: cli.password };
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (query) => new Promise(resolve => rl.question(query, resolve));
  
  let username = cli.username;
  let password = cli.password;
  
  if (!username) {
    username = await question('Instagram username: ');
  }
  
  if (!password) {
    // Note: This doesn't hide password input, but it's a simple solution
    password = await question('Instagram password: ');
  }
  
  rl.close();
  return { username, password };
}

// Function to authenticate with Instagram
async function authenticateInstagram(browser, credentials) {
  const spin = ora({ text:'Authenticating with Instagram...', spinner:cliSpinners.dots }).start();
  
  // First check if we have valid cookies
  const savedCookies = readCookies();
  if (savedCookies) {
    spin.text = 'Using saved cookies...';
    
    // Create a test page to check if cookies are valid
    const testPage = await browser.newPage();
    await testPage.setUserAgent(USER_AGENTS[0]);
    
    // Set the cookies
    await testPage.setCookie(...savedCookies);
    
    try {
      // Test if we can access Instagram
      await testPage.goto('https://www.instagram.com/', { 
        waitUntil: 'networkidle2',
        timeout: NAV_TIMEOUT_MS 
      });
      
      // Check if we're logged in by looking for logout button or similar indicator
      const isLoggedIn = await testPage.evaluate(() => {
        return document.querySelector('svg[aria-label="Settings"]') !== null ||
               document.querySelector('svg[aria-label="Your profile"]') !== null;
      });
      
      if (isLoggedIn) {
        spin.succeed('Successfully authenticated with saved cookies');
        await testPage.close();
        return savedCookies;
      }
    } catch (err) {
      console.log('Error testing cookies:', err.message);
    }
    
    await testPage.close();
    spin.text = 'Saved cookies invalid, logging in...';
  }
  
  // If no valid cookies, perform login
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENTS[0]);
  
  try {
    // Navigate to login page
    await page.goto(LOGIN_URL, { 
      waitUntil: 'networkidle2',
      timeout: NAV_TIMEOUT_MS 
    });
    
    // Wait for the page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Accept cookies if the dialog appears
    try {
      const acceptCookiesButton = await page.$x("//button[contains(., 'Accept') or contains(., 'Allow')]");
      if (acceptCookiesButton.length > 0) {
        await acceptCookiesButton[0].click();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (err) {
      // Ignore errors if cookie dialog doesn't appear
    }
    
    // Fill in username
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.type('input[name="username"]', credentials.username, { delay: 50 });
    
    // Fill in password
    await page.waitForSelector('input[name="password"]', { timeout: 5000 });
    await page.type('input[name="password"]', credentials.password, { delay: 50 });
    
    // Click login button
    const loginButton = await page.$('button[type="submit"]');
    if (!loginButton) {
      throw new Error('Login button not found');
    }
    
    await loginButton.click();
    
    // Wait for navigation
    await page.waitForNavigation({ timeout: NAV_TIMEOUT_MS });
    
    // Wait a bit more to ensure we're fully logged in
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check if login was successful
    const currentUrl = page.url();
    if (currentUrl.includes('challenge') || currentUrl.includes('login')) {
      throw new Error('Login failed or additional verification required');
    }
    
    // Get cookies
    const cookies = await page.cookies();
    
    // Save cookies for future use
    saveCookies(cookies);
    
    spin.succeed('Successfully authenticated with Instagram');
    await page.close();
    return cookies;
  } catch (err) {
    spin.fail(`Authentication failed: ${err.message}`);
    await page.close();
    process.exit(1);
  }
}

/* ── MAIN ──────────────────────────────────────────────────────────────── */
(async () => {
  ensureDir(OUT_DIR);
  const spin = ora({ text:'Starting…', spinner:cliSpinners.dots }).start();

  let usernames = await parseInput(cli.input);
  const progress = readProgress();
  usernames      = usernames.filter(u => !(u in progress.done));

  if (!usernames.length) {
    spin.succeed('Everything already scraped. Nothing to do.');
    process.exit();
  }

  // Launch browser
  const browser = await puppeteer.launch({ 
    headless: 'new',
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    args: [
      '--disable-features=IsolateOrigins',
      '--disable-site-isolation-trials',
      '--disable-web-security'
    ]
  });

  // Get credentials and authenticate (unless noAuth is specified)
  let cookies = [];
  if (!cli.noAuth) {
    const credentials = await promptCredentials();
    cookies = await authenticateInstagram(browser, credentials);
  } else {
    console.log('Running in non-authenticated mode (limited functionality)');
  }
  
  let pages = 0, saved=progress.stats.saved, failed=progress.stats.failed;

  const newPage = async () => {
    pages++;
    const page = await browser.newPage();
         await page.setUserAgent(USER_AGENTS[pages % USER_AGENTS.length]);
     
     // Set cookies to ensure we're authenticated (if available)
     if (cookies.length > 0) {
       await page.setCookie(...cookies);
     }
    
    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', r => {
      const t = r.resourceType();
      (t === 'document' || t === 'xhr' || t === 'fetch' || t === 'image') 
        ? r.continue() : r.abort();
    });
    
    return page;
  };

  const queue = [...usernames];
  const workers = Array.from({ length: +cli.concurrency }).map(async () => {
    while (queue.length) {
      const user = queue.shift();
      let attempt = 0, ok = false, wait = 1000;

      while (attempt < cli.maxRetries && !ok) {
        attempt++;
        
        // Create a new page for each attempt
        const page = await newPage();
        
        try {
          spin.text = `Processing ${user} (attempt ${attempt}/${cli.maxRetries})`;
          
          // Navigate to the user's profile page
          await page.goto(`${PROFILE_BASE_URL}${user}/`, {
            waitUntil: 'networkidle2',
            timeout: NAV_TIMEOUT_MS
          });
          
          // Wait a bit for any dynamic content
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Extract profile picture using multiple methods
          const pic = await page.evaluate(() => {
            // Method 1: Check for profile picture in page context
            const extractFromContext = () => {
              try {
                // Look for profile data in window._sharedData
                if (window._sharedData && window._sharedData.entry_data && 
                    window._sharedData.entry_data.ProfilePage) {
                  const user = window._sharedData.entry_data.ProfilePage[0].graphql.user;
                  return user.profile_pic_url_hd || user.profile_pic_url;
                }
                
                // Look for profile data in script tags
                const scripts = document.querySelectorAll('script[type="text/javascript"]');
                for (const script of scripts) {
                  if (script.textContent.includes('profile_pic_url')) {
                    const match = script.textContent.match(/"profile_pic_url_hd":"([^"]+)"|"profile_pic_url":"([^"]+)"/);
                    if (match) return (match[1] || match[2]).replace(/\\u0026/g, '&');
                  }
                }
                
                return null;
              } catch (e) {
                return null;
              }
            };
            
            // Method 2: Check for profile picture in meta tags
            const extractFromMeta = () => {
              const metaTag = document.querySelector('meta[property="og:image"]');
              return metaTag ? metaTag.content : null;
            };
            
            // Method 3: Check for profile picture in img elements
            const extractFromImages = () => {
              // Profile picture is usually in a header or has specific attributes
              const selectors = [
                'img[alt*="profile picture"]',
                'header img',
                'img[data-testid="user-avatar"]',
                'img.x6umtig',  // Common Instagram class for profile pictures
                'img[alt*="profile photo"]'
              ];
              
              for (const selector of selectors) {
                const img = document.querySelector(selector);
                if (img && img.src && !img.src.includes('rsrc.php')) {
                  return img.src;
                }
              }
              
              return null;
            };
            
            // Try all methods
            return extractFromContext() || extractFromMeta() || extractFromImages();
          });
          
          if (pic) {
            console.log(`Found profile picture URL for ${user}: ${pic}`);
            
            // Download the profile picture
            await download(pic, path.join(OUT_DIR, `${user}.jpg`));
            progress.done[user] = 'saved';
            progress.stats.saved = ++saved;
            ok = true;
            spin.text = chalk.green(`[saved] ${user} ${saved}/${usernames.length}`);
          } else {
            throw new Error('Profile picture not found');
          }
        } catch (err) {
          console.log(`Error processing ${user}: ${err.message}`);
          
          if (attempt === cli.maxRetries) {
            progress.done[user] = 'failed';
            progress.stats.failed = ++failed;
            spin.text = chalk.red(`[fail] ${user}: ${err.message}`);
          } else {
            // Wait before retrying
            await new Promise(r => setTimeout(r, wait));
            wait *= 2;
          }
        } finally {
          await page.close().catch(() => {});
          saveProgress(progress);
        }
      }
    }
  });

  await Promise.all(workers);
  await browser.close().catch(() => {});
  spin.succeed(chalk.bold(`Finished ✔  saved:${saved}  failed:${failed}`));
})();

/* ── graceful exit ─────────────────────────────────────────────────────── */
['SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException']
  .forEach(ev => process.on(ev, () => {
    console.log('\nGraceful exit – progress saved.');
    try { const p = readProgress(); saveProgress(p); } finally { process.exit(); }
  }));
