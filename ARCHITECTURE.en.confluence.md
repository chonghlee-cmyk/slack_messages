# 📡 Slack HUB

> A system that automatically organizes Slack channel messages into Google Sheets + a web dashboard

🔗 **Dashboard:** https://toomics-dashboard.vercel.app
📁 **GitHub:** https://github.com/chonghlee-cmyk/slack_messages

---

## 🎯 What does it do?

Every day at 2 AM KST, automatically:

1. **Fetches** yesterday's & today's messages/replies from Slack
2. **Stores images separately** so they can be viewed anywhere
3. **Auto-classifies with AI** to tag the issue type and identify which title it belongs to
4. **Organizes everything** in Google Sheets + Supabase + web dashboard

→ When you come to work, neatly organized data is already in your sheet and dashboard ✨

---

## 📊 The Big Picture

```
┌─────────────────┐     ┌──────────────┐     ┌────────────────┐     ┌──────────────┐     ┌──────────────────┐
│  💬 Slack       │ ──▶ │ ✨ Auto      │ ──▶ │ 📋 Google      │ ──▶ │ 🗄 Supabase  │ ──▶ │ 📈 Dashboard     │
│  Channel        │     │  Pipeline    │     │   Sheets       │     │ (DB + Image) │     │ (Vercel hosted)  │
│ 작품관련소통    │     │ (GitHub      │     │ (human review) │     │              │     │                  │
│                 │     │  Actions)    │     │                │     │              │     │                  │
└─────────────────┘     └──────────────┘     └────────────────┘     └──────────────┘     └──────────────────┘
```

**Role of each layer:**

| Layer | Role |
|-------|------|
| **Google Sheets** | Workspace where humans view, edit, and review |
| **Supabase** | Data warehouse for the dashboard (fast queries, image hosting) |
| **Dashboard** | Search/filter/visualization UI (supports ~50 concurrent users) |

---

## 🤖 Daily Automated Pipeline (4 Steps)

### Step 1 — Fetch Messages

```
Slack Channel (yesterday~today) → Filter bot alerts → Format name/date/time → Append to sheet
```

- Only collects **human-written messages and replies** (auto bot alerts filtered out)
- Mentions are converted to actual names (`<!subteam^...>` → `@Global Content`)
- Replies include the **parent message for context**

### Step 2 — Process Images

```
Slack image → Download → Convert to WebP (-88%) → Upload to Supabase (30-day cache) → New link in sheet
```

- Slack images require login → **can't be displayed on dashboard**
- So we convert them to **public links** and store separately
- Compressed **88%** (910MB → 105MB)
- **30-day browser cache** — same image isn't re-downloaded (saves egress)

### Step 3 — AI Auto-Classification

```
Message text → AI analysis → Classify issue type + Find title → Match against title DB → Add to sheet
```

- AI reads each message and **classifies the issue type** (8 categories)
- **Extracts title number/name** and matches against title database
- Handles typos automatically (e.g., `8731 부녀회장` → DB has `8730 부녀회장` → corrected)
- **Multi-title mentions**: When one message references multiple titles, **a separate row is created per title** (e.g., "한지붕 아래 + 두근두근" → 2 rows)
- **Language variant matching**: `한지붕 아래`, `한지붕 아래[영어 전용]`, `한지붕 아래[프랑스어 전용]` are treated as the same title group → rows duplicated for each variant

### Step 4 — Sync to Supabase DB

```
Google Sheets (complete data) → Upload to Supabase tables (upsert) → Fast queries from dashboard
```

- Copies all sheet rows (messages, classifications, title matches) to **Supabase DB**
- Also syncs 2,009 titles to a separate table
- **14,000 rows synced in ~7 seconds**
- Dashboard queries **Supabase instead of Sheets** → much faster

---

## 📈 Web Dashboard

🔗 **https://toomics-dashboard.vercel.app**

```
Work List (search/filter) ─┐
                           ▼
                    Work Detail ─┬─▶ Per-language info (PT/EN/ES/IT/DE/FR/TC/JP/TH)
                                 ├─▶ Manuscript revisions
                                 ├─▶ Slack messages (category groups)
                                 └─▶ Per-language memos
```

**Key features:**

| Feature | Description |
|---------|-------------|
| 🔍 **Work search** | Auto Korean/English conversion, filters by status/genre/platform |
| 📊 **Per-language info** | 9 language tabs (PT/EN/ES/IT/DE/FR/TC/JP/TH) |
| 💬 **Slack messages** | Grouped by category, threaded reply view |
| 📷 **Click-to-load images** | Just shows "N images" text by default, downloads only on click (egress savings) |
| 📝 **Per-language memos** | Internal team comments (CRUD) |
| ⭐ **Favorites** | Mark frequently viewed items |

---

## 📋 What's in the Sheet?

| Column | Content | Example |
|--------|---------|---------|
| Is Reply | Reply or not | `TRUE` (reply) / `FALSE` (original) |
| Channel | Channel name | `작품관련소통_contentscomms` |
| Sender | Author | `Hong Gildong` |
| Date / Time | Date·time (KST) | `2026-05-21 / 14:30:22` |
| Message | Message content | `8730 부녀회장 page missing` |
| Link | Original Slack link | (click to open Slack) |
| Parent Message | (if reply) original message | `8730 부녀회장 author change...` |
| Parent Link | (if reply) parent link | (click to open Slack) |
| Image URLs | Public image links | `["https://...webp"]` |
| Image Count | Image count | `2` |
| Image Sizes (MB) | Total image size | `1.85` |
| **Category** | AI issue category | `Manuscript/PSD` |
| **Sub Category** | Detailed type | `Missing pages` |
| **Title Number** | Auto-extracted | `8730` |
| **Title Name** | Auto-extracted | `부녀회장` |
| **Title Match** | Confidence | `Exact` / `Name match` / `Similar` / `None` |

> 💡 **Multi-title messages**: When one message mentions multiple titles, additional rows are auto-generated with identical content but different title numbers. All searchable per title on the dashboard.

---

## 🏷️ The 8 AI Categories

| Category | Examples |
|----------|----------|
| 📄 **Manuscript/PSD** | Missing pages, PSD issues, missing logos, manuscript edits/replacements |
| 📅 **Schedule** | Upload schedule, hiatus, serialization resume/stop |
| ✍️ **Metadata/Author** | Author change, title change, season/spinoff |
| 📜 **License/Contract** | Rights termination, service termination |
| 🌐 **Localization/Translation** | Translation halt, language-specific issues |
| 💰 **BM/Type Change** | BM change, price change |
| 🚀 **Launch/Open** | New launch, uncensored launch |
| 💬 **Other** | General chat, hard to classify |

---

## 🎯 Title Match Confidence

| Label | Meaning |
|-------|---------|
| **Exact** | Both number and name match the DB ✅ |
| **Name Match** | Number was wrong but name matched → corrected to DB's number |
| **Number Match** | Only number found, no name |
| **Similar** | Possible typo → estimated as closest title |
| **None** | Couldn't find title info (e.g., reply "Confirmed") |

---

## 📈 Data Collected So Far

| Item | Value |
|------|-------|
| Period | Feb 2024 ~ May 2026 (~**2 years 3 months**) |
| Total rows | **14,346** |
| Human messages | 2,767 |
| Human replies | 11,579 |
| Images | 2,527 files (105 MB, WebP) |
| Title DB | 2,009 titles |
| AI classification | ~4,000/day (within Gemini free tier) |

---

## 🆓 Cost

**Completely free** to operate:

- Slack API
- Google Sheets
- Supabase Storage (1GB free, currently 10% used)
- Google Gemini AI (within free tier, 4-key rotation)
- GitHub Actions (free automated execution)
- Vercel (dashboard hosting)

---

## 🔄 How does it run daily?

```
⏰ Daily at 2 AM & 6 PM KST
       ↓
🔄 GitHub Actions auto-runs
       ↓
1️⃣ Fetch messages (yesterday+today)
       ↓
2️⃣ Process images
       ↓
3️⃣ AI classification
       ↓
4️⃣ Sync to Supabase
       ↓
✅ Dashboard auto-updates
```

- Runs in the **cloud** even when your computer is off
- Only processes **10-50 new messages per day** (1-2 minutes)
- If a day fails, the next run automatically picks up what was missed

---

## 💡 Next Steps

- ✅ ~~Finish AI classification~~ (in progress)
- ✅ ~~Build dashboard~~ → **Done** (https://toomics-dashboard.vercel.app)
- ⬜ Title-level issue trend visualization
- ⬜ Auto-alerts (for specific issue types)
- ⬜ Add more Slack channels (currently 1 → multiple)

---

## ❓ FAQ

**Q. When do new messages appear in the sheet/dashboard?**

→ Automatically at 2 AM and 6 PM KST daily. Manual trigger available if needed urgently.

**Q. Why don't I see bot notifications in the sheet?**

→ Bot messages (like `B098BGM0L15` auto-alerts) are filtered out since they're not human conversation.

**Q. The AI got the classification wrong. What do I do?**

→ You can edit directly in the sheet. Future automated runs won't overwrite your edits.

**Q. How does the title DB get updated?**

→ The "작품정보" tab is linked to an external DB and always stays in sync automatically.

**Q. Images suddenly stopped showing. Why?**

→ Supabase free tier is capped at 1GB. Currently at 10% — plenty of room.

**Q. Why do I have to click to view images on the dashboard?**

→ Intentional. To save free-tier bandwidth (5GB/month egress), images load only on click. Once viewed, images are browser-cached for 30 days.

**Q. Why is the same message appearing twice?**

→ If a message mentions multiple titles, we create a separate row per title. Same content, different title number.

---

For questions or requests, please reach out on Slack! 🙌
