# IG-Avatar-Scraper

> **Lightning-fast, crash-proof Instagram profile-picture downloader  
> Made by *Saam* — Software Engineer, Very Fast⚡**

---

<div align="center">
  <img src="https://raw.githubusercontent.com/<your-repo-url>/docs/demo.gif" width="520" alt="terminal demo">
</div>

IG-Avatar-Scraper chews through **any text / CSV / JSON list** of Instagram handles, grabs each account’s HD avatar and saves it as `USERNAME.jpg`.  
It uses one stealth headless-Chrome instance with multiple tabs in parallel, writes progress to disk after every profile, and resumes exactly where it left off — perfect for huge lists that run overnight (or all week).

---

## ✨ Key features

| ✔ | What it does | Why it matters |
|---|--------------|----------------|
| **Stealth headless Chrome** | Puppeteer + `puppeteer-extra-plugin-stealth` | Looks like a real browser — no login, no proxies required |
| **Parallel tabs** | `--concurrency` flag (default 6) | Crank up your bandwidth & CPU for big speed gains |
| **Block heavy assets** | Only HTML/XHR fetched | 80-90 % less bandwidth than a full page load |
| **Persistent progress** | `progress.json` auto-saved | Crash, power-loss, Ctrl-C — just restart & it skips what’s done |
| **Retry + back-off** | `--maxRetries` (default 2) | Recovers from flaky connections without pausing the whole run |
| **CLI UX** | Colorized spinner + live counters | Keeps long jobs readable in real time |

---

## 🚀 Quick start

```bash
git clone https://github.com/<your-handle>/ig-avatar-scraper
cd ig-avatar-scraper
npm install                  # installs puppeteer, axios, chalk, ora, yargs

# simplest run: one handle per line
node ig-avatar-scraper.js --input usernames.txt
Other examples
bash
Copy
Edit
# CSV file with column header "instagram"
node ig-avatar-scraper.js -i people.csv -c instagram

# JSON array of objects with key "ig"
node ig-avatar-scraper.js -i users.json -k ig -n 10      # 10 parallel tabs

# Custom output directory & 3 retries each
node ig-avatar-scraper.js -i list.txt -o avatars -r 3
Flag	Default	Description
-i, --input	required	txt / csv / json file containing handles
-c, --column	0	CSV column (index or header)
-k, --jsonKey	–	Key to read when input is JSON
-o, --outDir	pfp	Folder for downloaded .jpg files
-n, --concurrency	6	Tabs (Chrome pages) to run in parallel
-r, --maxRetries	2	Attempts per username before marking failed

🏗 How it works (under the hood)
Input parser – accepts plain text, CSV, or JSON arrays.

Progress loader – reads progress.json to skip finished handles.

Single Chrome – launches once, then opens/recycles tabs.

Asset blocking – intercepts requests; only HTML & XHR continue.

Avatar extraction – pulls the <meta property="og:image"> tag or the profile_pic_url_hd JSON key.

Streaming download – writes outDir/USERNAME.jpg straight to disk.

Flush progress – every handle (saved or failed) updates progress.json.

Graceful shutdown – SIGINT / unhandled errors flush progress before exit.

📦 Files
graphql
Copy
Edit
ig-avatar-scraper/
├─ ig-avatar-scraper.js   # single executable CLI (ESM)
├─ package.json           # minimal deps list
└─ README.md              # what you're reading
🙋‍♂️ Author
Saam – high-school student by day, software engineer by night.
He built this tool after needing to archive thousands of IG avatars without getting rate-limited or losing progress.

📜 License
MIT – free for personal & commercial use.
Contributions & ⭐ stars are welcome!
