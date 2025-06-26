# IG-Avatar-Scraper

> **Lightning-fast, crash-proof Instagram profile-picture downloader  
> Made by *Saam* — Software Engineer, Very Fast⚡**

---

<div align="center">
  <img src="https://raw.githubusercontent.com/<your-repo-url>/docs/demo.gif" width="520" alt="terminal demo">
</div>

IG-Avatar-Scraper chews through **any text / CSV / JSON list** of Instagram handles, grabs each account's HD avatar and saves it as `USERNAME.jpg`.  
It uses authenticated sessions with Instagram to ensure access to profile pictures, writes progress to disk after every profile, and resumes exactly where it left off — perfect for huge lists that run overnight (or all week).

---

## ✨ Key features

| ✔ | What it does | Why it matters |
|---|--------------|----------------|
| **Instagram Authentication** | Logs in with your account | Ensures access to profile pictures even with Instagram's restrictions |
| **Cookie Storage** | Saves session for reuse | No need to log in every time you run the script |
| **Stealth headless Chrome** | Puppeteer + `puppeteer-extra-plugin-stealth` | Looks like a real browser to avoid detection |
| **Parallel tabs** | `--concurrency` flag (default 3) | Crank up your bandwidth & CPU for big speed gains |
| **Block heavy assets** | Only essential resources fetched | 80-90 % less bandwidth than a full page load |
| **Persistent progress** | `progress.json` auto-saved | Crash, power-loss, Ctrl-C — just restart & it skips what's done |
| **Retry + back-off** | `--maxRetries` (default 3) | Recovers from flaky connections without pausing the whole run |
| **CLI UX** | Colorized spinner + live counters | Keeps long jobs readable in real time |

---

## 🚀 Quick start

```bash
git clone https://github.com/<your-handle>/ig-avatar-scraper
cd ig-avatar-scraper
npm install                  # installs puppeteer, axios, chalk, ora, yargs

# simplest run: one handle per line (will prompt for Instagram credentials)
node ig-avatar-scraper.js --input usernames.txt
```

## Other examples

```bash
# CSV file with column header "instagram", with credentials
node ig-avatar-scraper.js -i people.csv -c instagram -u your_username -p your_password

# JSON array of objects with key "ig"
node ig-avatar-scraper.js -i users.json -k ig -n 5      # 5 parallel tabs

# Custom output directory & 3 retries each
node ig-avatar-scraper.js -i list.txt -o avatars -r 3
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `-i, --input` | required | txt / csv / json file containing handles |
| `-c, --column` | 0 | CSV column (index or header) |
| `-k, --jsonKey` | – | Key to read when input is JSON |
| `-o, --outDir` | pfp | Folder for downloaded .jpg files |
| `-n, --concurrency` | 3 | Tabs (Chrome pages) to run in parallel |
| `-r, --maxRetries` | 3 | Attempts per username before marking failed |
| `-u, --username` | – | Instagram username for authentication |
| `-p, --password` | – | Instagram password for authentication |
| `--cookiesFile` | ig_cookies.json | File to store/load Instagram cookies |

## 🏗 How it works (under the hood)

1. **Authentication** - Logs in to Instagram or uses saved cookies
2. **Input parser** – accepts plain text, CSV, or JSON arrays
3. **Progress loader** – reads progress.json to skip finished handles
4. **Single Chrome** – launches once, then opens/recycles tabs
5. **Asset blocking** – intercepts requests; only essential resources continue
6. **Avatar extraction** – uses multiple methods to find profile pictures:
   - Page context data (window._sharedData)
   - Meta tags (og:image)
   - Image elements with profile picture attributes
7. **Streaming download** – writes outDir/USERNAME.jpg straight to disk
8. **Flush progress** – every handle (saved or failed) updates progress.json
9. **Graceful shutdown** – SIGINT / unhandled errors flush progress before exit

## 📦 Files

```
ig-avatar-scraper/
├─ ig-avatar-scraper.js   # single executable CLI (ESM)
├─ package.json           # minimal deps list
├─ ig_cookies.json        # saved Instagram session (created on first run)
└─ README.md              # what you're reading
```

## 🙋‍♂️ Author

Saam – high-school student by day, software engineer by night.
He built this tool after needing to archive thousands of IG avatars without getting rate-limited or losing progress.

## 📜 License

MIT – free for personal & commercial use.
Contributions & ⭐ stars are welcome!
