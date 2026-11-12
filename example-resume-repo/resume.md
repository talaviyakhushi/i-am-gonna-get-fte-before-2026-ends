# Khushi Talaviya — Master Profile

> Single source of truth for all resume generation. Read this fully before generating any resume.
> Do not modify unless Khushi explicitly asks.
>
> Sections marked *Derivation*, "Context for tailoring", and "Bullet variants" are guidance for
> the tailoring agent — use them to pick and phrase content, but never copy them verbatim into
> `tailored-resume.md`.

---

## Contact

- **Email:** khushitalaviya0912@gmail.com
- **LinkedIn:** linkedin.com/in/khushitalaviya
- **GitHub:** github.com/talaviyakhushi
- **Portfolio:** khushitalaviya.vercel.app
- **Location:** New York, NY

---

## Education

**New Jersey Institute of Technology** — Newark, NJ
M.S. Computer Science | Completed May 2026 | GPA: 3.8

(Degree is COMPLETED — never phrase as "completing", "pursuing", or "expected".)

---

## Skills

**Languages:** Java, Python, TypeScript, JavaScript, SQL, HTML5, CSS3
**Frameworks / Libraries:** Spring Boot, Spring MVC, JPA/Hibernate, Angular, NestJS, React, FastAPI, Node.js, TailwindCSS, Angular Material, RxJS, NGXS, Zustand, Apollo GraphQL, Spring RestTemplate
**Databases:** MySQL, PostgreSQL, MongoDB, Supabase (pgvector)
**Cloud / DevOps:** AWS (Amplify, EC2, RDS, S3), Docker, GitHub Actions, CI/CD, Cloudinary, Supabase
**Testing / Tools:** JUnit, Git, Maven, Postman, Jira, Figma
**Practices:** Agile/Scrum, unit and integration testing

(Classification note for the agent: keep categories semantically correct in
tailored output — Agile/Scrum and API design are Practices, never Tools;
JUnit is a testing framework; REST APIs is not a tool.)

(An "AI / ML" skills category is allowed ONLY when the JD itself signals AI/
LLM relevance — mentions AI tooling, LLM APIs, GenAI, or ML as part of the
role, even as a nice-to-have. When allowed, keep it honest: OpenAI API, RAG
pipelines, vector search (pgvector) — real evidenced work (see Outfitted, AI
Price Estimator), not an ML-expertise claim. For any JD without that signal,
omit the category entirely — OpenAI/RAG/embeddings still surface in project
and experience bullets where the work itself is the evidence, just never
forced into Skills as a category the JD didn't ask for.)

---

## Experience

### Forty7 — Software Developer Co-op
**Location:** New York, NY
**Duration:** January 2026 – May 2026
**Stack:** Angular 18, TypeScript, NGXS, Apollo GraphQL (codegen), NestJS, TypeORM, PostgreSQL, AWS (S3, SES, SNS), Angular SSR, Klaviyo API, WATI (WhatsApp Business API), Microsoft Clarity, SCSS
**Project context:** Forty7 is a live diamond and gemstone auction platform with 100 users — Angular SSR frontend, NestJS/GraphQL API, Angular admin panel. Khushi joined an existing production codebase and contributed across all three apps: third-party marketing/analytics integrations, guest access architecture, new pages from scratch, GraphQL schema extensions, and NestJS backend fixes.

---

**The work:** Delivered features across frontend, NestJS backend, and admin panel in a real production environment with live users. Owned third-party integrations end-to-end (browser SDK → backend service → GraphQL), fixed auth race conditions in NGXS state management, built multiple pages from scratch, and extended GIA GraphQL schema to support new listing UI.

---

**Analytics & Marketing Integrations (full-stack):**
- Built a third-party tracking integration in Angular, injected into signup flows for both individual and business users, safe to run during server-side rendering
- Fixed a NestJS backend bug where a duplicate-signup error was failing silently — fixed by re-routing the user into the existing subscription flow instead
- Built a guest identity-resolution flow that attributes analytics events without requiring an authenticated session

**WhatsApp Messaging Integration (end-to-end):**
- Extended the NestJS backend to support an admin-triggered WhatsApp message, restricted by role and safe to trigger only once per user
- Updated message templates when business requirements changed
- Surfaced the trigger action in the Angular admin panel's business users table

**Guest Access Architecture:**
- Reworked auth in Angular so unauthenticated users could browse key pages and interact with core features without logging in
- Fixed a state-management race condition where route guards evaluated before login state was ready, causing incorrect redirects on app load
- Root cause: state was reset on logout in a way that wiped a readiness flag — fixed by excluding auth state from that reset

**Pages Built / Significantly Developed:**
- Built the About Us page in Angular with a dynamic carousel driven by an extended GraphQL query, linking each item to its listing
- Built a new Request Access page and route from scratch
- Overhauled markup and layout across four core pages (Auctions/Home, How It Works, Sell With Us, FAQs)
- Updated navigation to adapt dynamically based on auth and listing state

**Results Tab:**
- Added a Results tab to listing pages in Angular, replacing an old auto-redirect with tab-based navigation

**FCRF Certificate Fix:**
- Fixed a data-mapping bug in NestJS and Angular when an upstream certificate API changed its response format

**Bug Fixes:**
- Fixed a JWT token-signing bug that produced identical session tokens for concurrent logins
- Fixed an inverted filter condition in the admin panel that blocked valid listings and allowed invalid ones

---

**Max Bid (Proxy Bidding) Feature — built end-to-end (do not phrase as "sole developer/owner" in output; "owned end to end" is the ceiling):**
- Built a complete proxy bidding system end-to-end across a NestJS/GraphQL API, PostgreSQL, and an Angular admin panel
- Added validation ensuring only one active max bid per user per lot, with rules preventing conflicts between manual and automated bids
- Built an automated resolution process that determines and places counter-bids after each new bid, and suppresses redundant notifications for active max-bid holders
- Updated the bid increment rule from a flat 2% to 3%, rounded up to the nearest $100
- Added a new PostgreSQL-backed notification type, plus an email and WhatsApp confirmation message, when a max bid is set
- Extended the Angular bidding UI to toggle between manual and max-bid modes
- Added a Redis cache layer for frequently-read bid state, cutting repeated database reads during high-frequency bidding
- Live across the last 3 auctions (15 lots total)

**Load Testing & Concurrency Fixes (Max Bid feature):**
- Designed and ran k6 load tests against the proxy bidding feature simulating 1,000 concurrent users with requests roughly 0.1 milliseconds apart, proactively surfacing race conditions before they reached production
- Fixed a duplicate-notification bug where proxy bidding and manual bidding both sent outbid alerts to the same user under simultaneous load — deduplicated by tracking who had already been notified
- Fixed a message-ordering bug where outbid alerts could arrive before the bid-accepted confirmation — added a short delay before proxy-bid processing to guarantee correct delivery order across notification channels
- Fixed a duplicate-bid bug where simultaneous requests on the same lot could each trigger their own proxy-bid process — assigned each lot's proxy resolution a single job so only one instance runs at a time, guaranteeing exactly-once bid placement under concurrent load
- Root cause affected both data integrity (duplicate bids) and notification correctness — found and fixed through load testing before reaching production

---

**AI Price Estimator (separate deployed product, built end-to-end — same phrasing rule: no "sole developer/solo" in output):**
- Built a standalone AI-powered pricing tool end-to-end — Angular, Spring Boot, and MySQL, using GPT-4o vision — live in production on AWS (EC2 and Amplify)
- Added image deduplication via Cloudinary so the same photo is never processed twice
- Added a reCAPTCHA verification gate before any AI call
- Automated deployment via GitHub Actions CI/CD, with separate frontend and backend pipelines
- Benchmarked accuracy: 90% against 3,000+ real marketplace listings
- Used by ~100 people in production; end-to-end response completes in a few seconds
- Added a completeness check before calling the AI model, to avoid unnecessary API calls when input data is incomplete

---

**Bullet variants by role type** *(pick 2–3 most relevant per JD)*

*Fullstack / SWE:*
- Built proxy bidding (max bid) system end-to-end at Forty7: TypeORM entity + migration, NestJS GraphQL mutation with custom class-validator constraints, Bull queue processor for proxy resolution logic, and Angular modal UI with NGXS state — business-critical auction feature owned end to end
- Contributed across Angular SSR frontend, NestJS/GraphQL backend, and admin panel at Forty7 — built WATI WhatsApp integration end-to-end (TypeORM entity → GraphQL mutation → admin UI), wired Klaviyo and Microsoft Clarity analytics, and architected guest access flow for a live auction platform
- Built AI price estimator end-to-end (Angular 19 + Spring Boot 3.5 + gpt-4o vision, live in production): photo upload → AI classification + form pre-fill → domain-tuned pricing prompt → MySQL persistence, with reCAPTCHA gate and GitHub Actions CI/CD

*Backend / API:*
- Implemented proxy bid resolution as a Bull queue job: determines bid amount from ranked max bids, handles all outbid notification paths, and suppresses redundant notifications for max bid holders — designed idempotent and collision-safe with manual bidding
- Added a Redis cache layer to the proxy bidding system at Forty7, cutting repeated database reads for frequently-accessed bid state under high-frequency bidding load
- Extended NestJS/GraphQL API at Forty7: added role-guarded mutations, TypeORM entity columns, idempotent WhatsApp message sending, and fixed upstream FCRF certificate API response mapping
- Fixed NGXS auth state race condition on app init: added `initialized` flag to prevent route guards from evaluating before localStorage token hydration completed
- Built Spring Boot 3.5 backend for AI estimator: gpt-4o vision classification, Cloudinary upload with SHA-256 dedup, reCAPTCHA verification, MySQL persistence, deployed to EC2 with systemd + GitHub Actions

*Frontend / Angular:*
- Built About Us page with GraphQL-backed dynamic carousel, Results tab with extended GIA schema, and Request Access page from scratch in Angular 18 with SSR; reworked guest UX across lot detail, results, and header navigation
- Built SSR-safe KlaviyoService; implemented Microsoft Clarity user identification using Klaviyo cookie decoding for guest sessions — cross-tool identity without authenticated state
- Built Angular 19 estimator frontend: gpt-4o vision analyze flow, `ngOnChanges`-driven form pre-fill from AI response, reCAPTCHA render + token handling, RxJS `retry(1)` + `timeout(30000)` on analyze call

*AI / product:*
- Built and shipped AI luxury resale pricing tool at Forty7 (owned end to end, live production): gpt-4o vision classifies watch/jewelry from photo and extracts attributes → domain-tuned pricing prompt with conservative secondary-market constraints → USD price range returned and persisted — 90% accuracy benchmarked on 3,000+ items against The RealReal and LoupeThis listings

*Analytics / Integrations:*
- Integrated Klaviyo JS tracking and Microsoft Clarity identification in Angular SSR app; wired WATI WhatsApp Business API in NestJS with idempotency guard; fixed Klaviyo backend subscription flow for duplicate profile edge case

---

### NJIT — Research Assistant (under Prof. Komal Kumari)
**Location:** Newark, NJ
**Duration:** April 2025 – September 2025
**Stack:** Angular 15, TypeScript, Java 17, Spring Boot 3.4.5, REST APIs, Maven, Node.js, Gson, Jackson
**System context:** DBO (Document-Based Outsourcing) — document outsourcing research system. Documents distributed across 4 servers; clients search by keyword with access control per client. Khushi owned the full frontend and REST API layer. The research was published; the system was validated at 500K-document scale for the paper (scale testing performed after Khushi's involvement ended — frame as "contributed to published research", not as tests she ran).

---

**The work:** Built the complete Angular dashboard and REST API layer for a document outsourcing research system. Owned everything the user touches — DBO interface, client search interface, and all Spring Boot endpoints the frontend calls. Delivered two phases: API-first frontend design against contracts, then full backend integration.

---

**Angular Frontend (doc-dashboard — sole owner):**
- Built full Angular 15 app from scratch: DBO dashboard + client search interface, routing, service layer, dialogs, data models
- DBO dashboard: bulk file/directory upload, session-based file visibility (auto-expires 30 min), file add/delete, client ID management
- Keyword management UI: view all extracted keywords post-processing, grant/revoke keyword access per client — Access Control Matrix interaction without exposing internals
- Client search view: keyword-based document search ("Google search" style), file open/download visualization
- *Derivation:* Session-expiry file display = no persistent plaintext exposed in UI — deliberate design matching the system's privacy model
- *Derivation:* Advisor explicitly required going beyond dropdowns — implemented drag-and-drop interactions and Apple Watch-style keyword bubble UI. Visual design was a graded deliverable, not an afterthought.

**Spring Boot REST API layer (added to provided codebase):**
- Added `OutSourceController` — 10+ REST endpoints wiring frontend to backend services:
  - `POST /api/upload`: bulk upload, per-client folder organization, numeric file ID assignment
  - `GET /api/documents`, `DELETE /api/documents/{clientId}/{fileId}`: document CRUD
  - `GET /api/all-keywords`, `DELETE /api/keywords/{keyword}`: keyword management
  - `POST /api/access/grant`, `POST /api/access/revoke`: client-keyword ACL mutations
  - `POST /api/initialize`, `GET /api/client-map`, `POST /api/update-keyword-map`: system bootstrap and mapping management
- Added `FileReceiverController` — `POST /upload` port-mapped to server-specific share directories (`8080→server1/share1`, `8082→server2/share2`, etc.) enabling distributed share storage across 4 servers
- JSON-based persistent mappings for client IDs, file metadata, and access permissions; CORS configured for Angular dev server
- *Derivation:* API-first Phase 1 — built entire frontend against contracts before backend existed. Forced clean interface separation.

**Integration (Phase 2):**
- Studied provided backend code to understand data shapes and API contracts
- Wired Angular service layer to live Spring Boot endpoints
- Reorganized codebase: merged outsource + grant-revoke modules into unified DBO package without touching existing logic

---

**Bullet variants by role type** *(pick 2–3 most relevant per JD)*

*Fullstack / SWE:*
- Built full Angular 15 dashboard and 10+ Spring Boot REST endpoints for a privacy-preserving document outsourcing research system — delivered API-first frontend design and full backend integration across two phases
- Designed Angular service layer against Spring Boot APIs for a distributed cryptographic document system: session-based file visibility, client-keyword access control, bulk upload with per-client organization

*Frontend / UI:*
- Built Angular 15 doc-dashboard from scratch for a research cryptography system — drag-and-drop interactions, Apple Watch-style keyword bubble UI, session-expiry file visibility, multi-view routing for DBO and client perspectives
- Visual design was an explicit deliverable: keyword browsing, access grant/revoke flows, and client-side document search all built for usability alongside functional correctness

*Backend / API:*
- Added 10+ REST endpoints to a Java 17 Spring Boot research system covering document CRUD, keyword management, client-keyword ACL, and port-mapped multi-server file distribution across 4 servers

---

### BNP Paribas — Software Engineer Intern
**Location:** Mumbai, India
**Duration:** January 2024 – July 2024
**Stack:** Java, Spring Boot, Angular, REST APIs, Maven, Git, JUnit, Agile/Scrum
**Project context:** Legacy financial risk-calculation engine being migrated from C and .NET to Java Spring Boot (Maven) for maintainability and modern tooling — a large multi-year migration (still ongoing 2+ years after Khushi's departure), delivered by a 12-person team. Khushi contributed across the full migration — backend logic, frontend, CSS — and also built an internal developer productivity tool from scratch in the onboarding phase.

---

**The work:** Started with two months of onboarding + internal tooling, then transitioned to sprint-based feature delivery on the core migration project. Delivered 10–12 Jiras across backend, frontend, and styling — with unit and integration tests for each.

---

**Jira Tracker Tool (Jan–Feb, sole owner):**
- Built internal team productivity tool during onboarding: form-based Jira logging where each team member records Jiras worked on per date
- Manager view: aggregated table of all team submissions, exportable (CSV/Excel)
- Full CRUD implementation — create, read, update, delete entries
- REST APIs built with Spring Boot; Angular frontend consuming them
- Used by the full 12-person team for daily Jira logging
- *Derivation:* Problem was real — tracking daily Jira activity across a team was manual and scattered. Tool centralized it. Saved meaningful manager time each sprint cycle.
- *Derivation:* Onboarding project served double purpose: learned the stack (Spring Boot + Angular) by shipping something, not just reading docs.

**Core Migration Project (March–July):**
- Worked on 10–12 Jiras across 5 months: mix of backend logic changes (Java Spring Boot), frontend changes (Angular), and CSS styling fixes
- Each Jira shipped with unit tests (JUnit) + additional test file covering integration or edge cases
- Participated in sprint planning, daily standups, retrospectives — Agile/Scrum delivery
- Used Git for version control; deployed changes to dev environment
- *Derivation:* C/.NET → Java Spring Boot migration = not greenfield. Required reading existing C/.NET business logic, understanding intent, then re-implementing correctly in Java idioms. Higher cognitive load than typical feature work.
- *Derivation:* Maven as build system — part of modernization rationale alongside Spring Boot. Standard enterprise Java toolchain choice.
- *Derivation:* Writing a test file per Jira (not per codebase) = disciplined habit. Ensures every change has a corresponding regression harness regardless of coverage elsewhere.

---

**Bullet variants by role type** *(pick 2–3 most relevant per JD)*

*Fullstack / SWE:*
- Delivered 10–12 Jiras across backend, frontend, and CSS on a C/.NET → Java migration at BNP Paribas — each Jira shipped with unit tests and integration test coverage
- Built internal Jira tracking tool from scratch: form-based daily logging per team member, manager-facing aggregated table with export — eliminated manual sprint reporting

*Backend / Java:*
- Contributed backend logic changes in Java Spring Boot across a legacy C/.NET → Java migration; implemented unit and integration tests per Jira in Agile sprint delivery at BNP Paribas
- Built REST API layer for internal team productivity tool using Spring Boot, reducing manual Jira activity tracking overhead for managers

*Frontend:*
- Delivered Angular frontend changes and CSS fixes across 10–12 Jiras in Agile sprints at BNP Paribas; built Angular UI for internal Jira tracker tool consuming Spring Boot REST APIs

*Testing / quality:*
- Maintained unit test + integration test file per Jira across 5 months of sprint delivery on a Java Spring Boot migration — disciplined per-change test coverage in an Agile team environment

---

## Projects

### Resume Tailor Agent — AI Job-Application Copilot
**Date:** July 2026
**Stack:** TypeScript, Node.js, Express, Chrome Extension (Manifest V3), Claude Agent SDK, pnpm workspaces, Server-Sent Events, LaTeX
**Tags:** AI, agentic, fullstack, tooling, personal project
**Status:** Built and in active personal use — runs locally, not yet deployed publicly or open-sourced

**What it does:**
Two connected tools for the job search. A scanner checks 471 companies' own job-board APIs daily for new, relevant, U.S.-based postings — filtering out stale listings and roles that exclude visa sponsorship before anything reaches the next step. A Chrome extension then captures a specific posting and tailors a resume to it in real time via the Claude Agent SDK, outputting a fit report and a ready-to-compile LaTeX resume over Server-Sent Events.

**Technical depth — every layer:**

*Job discovery pipeline:*
- Scans 471 companies directly via their own Greenhouse, Lever, and Ashby job-board APIs — no scraping, no guessing at URLs. That company list itself was built by verifying each one's ATS board actually exists with a real HTTP check against roughly 6,500 candidate U.S. employers, not by assuming
- Filters for role relevance and U.S.-only locations using word-boundary keyword matching, avoiding false positives a naive substring match would catch (e.g. "Software Engineer I" wrongly matching inside "Engineer Intern"), plus a second pass against the full job description text to catch experience-level requirements ("3+ years") that never show up in the title
- Skips postings older than 14 days by reading each posting's own schema.org `datePosted` field, and skips any posting that explicitly excludes visa sponsorship — both checked before any tailoring effort is spent on it

*Agent orchestration:*
- Backend runs the Claude Agent SDK driven by a markdown rulebook that encodes hard anti-fabrication boundaries, STAR-bullet style rules, and JD-fit heuristics (e.g. ranking which project or bullet to lead with per posting) — the agent reads the rulebook and a master resume file, then writes a tailored `.tex` resume and fit report per run
- A honesty-check service diffs the generated resume against the original master resume after generation, flagging any claim not traceable back to source

*Chrome extension (Manifest V3):*
- Content scripts extract job title/company/description from the active tab with per-site selector tables, scoring extraction confidence and letting the user correct low-confidence fields before submitting
- Background service worker proxies authenticated API calls (content scripts can't reach localhost directly) and consumes Server-Sent Events manually via a `ReadableStream` (`EventSource` can't carry auth headers), persisting run state across popup close/reopen and service-worker recycling

*Full-stack build and debugging:*
- pnpm monorepo in TypeScript throughout: Express API, MV3 extension, and a shared types/validation package consumed by both
- Found and fixed real production bugs surfaced through actual use: a LaTeX template bug that broke every generated resume (missing `amsmath` import, malformed list-environment nesting) and several agent rule gaps (bullet selection defaulting to the same project every run instead of ranking by JD fit, an AI-branded-company signal wrongly overriding a stronger literal keyword match)

**Context for tailoring:**
- Strong signal for agentic AI product roles, full-stack ownership, and roles that value iterating on a real system already in use, not a one-off school project
- Directly evidences hands-on experience building with an LLM agent SDK — relevant for any JD naming LLM APIs, agents, or AI-assisted development tooling
- Chrome extension + Express + SSE stack maps directly onto full-stack JDs asking for real-time features or browser-extension experience

**Bullet variants by role type** *(pick 2–3 most relevant per JD)*

*Fullstack / SWE:*
- Built a full-stack AI job-search tool end to end — a Chrome extension pairs with an Express API and Claude Agent SDK to tailor a resume to any posting in real time, guarded by checks that block fabricated claims

*Automation / data pipeline:*
- Surfaces new, relevant job postings daily across 471 companies by querying their Greenhouse, Lever, and Ashby job-board APIs directly, filtering to U.S.-based entry-level roles and skipping anything older than 14 days
- Cuts wasted effort by automatically skipping postings that explicitly exclude visa sponsorship or read as stale, before a single resume gets tailored to either

*AI / agentic:*
- Orchestrated the Claude Agent SDK against a markdown rulebook encoding anti-fabrication boundaries and JD-fit heuristics, with a separate honesty-check step diffing every generated output against source facts before it reaches the user

---

### Outfitted — AI Personal Styling Assistant
**Date:** March 2026
**Repo:** https://github.com/talaviyakhushi/outfitted
**Stack:** React 18, Vite, TailwindCSS, React Router, Zustand, FastAPI (Python), PostgreSQL (Supabase), pgvector, OpenAI API (gpt-4o, gpt-4o-mini, text-embedding-3-small), Cloudinary, rembg, Supabase Auth
**Tags:** AI, agentic, RAG, fullstack, personal project
**Status:** In progress, working locally — not yet deployed; tested by 10 users who uploaded 50–100 wardrobe items each (500+ items total)

**What it does:**
AI-powered personal wardrobe assistant. User uploads clothing photos → gpt-4o vision auto-classifies and embeds each item → chat interface retrieves relevant wardrobe pieces via semantic search → gpt-4o streams structured outfit suggestions → frontend renders 5-slot visual collages (top, bottom, shoes, accessories, jewelry).

**Technical depth — every layer:**

*Image upload + auto-classification (`ai_tagging_service.py`):*
- gpt-4o vision classifies each uploaded item: category, subcategory, color, occasion, season — strict JSON-only prompt, validated against enum whitelists, retry up to 2x on invalid response
- rembg removes background before Cloudinary upload for clean collage rendering
- text-embedding-3-small embedding generated from classification: `"A {color} {subcategory} in the {category} category. Suitable for {occasion} occasions and {season} weather"` → stored in `wardrobe_items.embedding vector(1536)` (pgvector)

*Intent extraction (`intent_service.py`):*
- gpt-4o-mini with JSON schema validation classifies each user message using last 4 conversation turns
- Extracts: `request_type` (outfit_request/greeting/off_topic), `is_vague`, `occasion`, `formality` (casual/smart_casual/formal), `weather_sensitivity`, `categories_needed`, `specific_items_mentioned`
- Vague requests short-circuit to clarification question before hitting retrieval

*RAG retrieval (`retrieval_service.py`):*
- Builds context-enriched query from intent fields + user profile (gender, body type, fit, style vibes) + raw message — embeds with text-embedding-3-small
- pgvector cosine similarity search via `match_wardrobe_items_v2` Supabase RPC (`<=>` operator), user-scoped, top-k=20
- Category gap-fill: if required categories absent from primary retrieval, runs targeted secondary RPC per missing category
- Weather → season filter: `warm→summer`, `cold/chilly/rainy→fall/winter`
- Retrieval starvation fallback: <8 results or missing tops/bottoms/shoes → full wardrobe passed to LLM
- Post-retrieval: merges full accessories + jewelry inventory regardless of similarity score

*Streaming chat + outfit generation (`ai_chat_service.py`):*
- Dynamic system prompt: wardrobe formatted as `"Item {i}: {color} {subcategory} ({category}, {occasion}, {season})"` + profile block injected per request
- gpt-4o streaming via SSE; chunks accumulated from `delta.content`
- Model outputs structured blocks: `OUTFIT_START / LABEL / TOP / BOTTOM / SHOES / ACCESSORIES / JEWELRY / OUTFIT_END`
- Regex parses outfit blocks from stream; fuzzy word-overlap scoring matches model descriptions to actual wardrobe item image URLs
- `OUTFIT_IMAGES` JSON payload appended to stream → frontend renders 5-slot collage per outfit

*Onboarding + auth:*
- 6-step onboarding: gender, height, body type, fit preference, style vibes, occasions, skin tone, colors, budget → `user_profiles` table, hydrates on edit
- Supabase Auth JWT frontend; backend validates Bearer token per request

**Context for tailoring:**
- Strong signal for AI/agentic, RAG, fullstack, and product roles
- Real multi-model orchestration: gpt-4o vision (tagging) + gpt-4o-mini (intent) + gpt-4o (chat) + text-embedding-3-small (retrieval) — four OpenAI models in one pipeline
- Retrieval design shows depth: intent-enriched queries, gap-fill logic, starvation fallback — not just "embed and search"
- End-to-end personal project shipped solo and validated with 10 test users: product thinking + engineering execution

---

### Real-Time AI Mock Interviewer
**Date:** February 2026
**Stack:** TypeScript, Node.js, Express, WebSockets, ElevenLabs, Google Gemini, Twelve Labs
**Tags:** AI, real-time, WebSocket, multi-API orchestration, hackathon
**Status:** Shipped — built in 24 hours by a 2-person team, later used by 100+ students at the university level

**What it does:**
Real-time voice-driven mock interview platform. User speaks → voice transcribed → Gemini generates interview question/feedback → ElevenLabs synthesizes spoken response → Twelve Labs handles video/code context — all over a single persistent WebSocket connection. Editor state streamed alongside audio for contextual AI follow-up per utterance.

**Technical depth:**

*Pipeline architecture:*
- 3 external APIs orchestrated over one WebSocket: ElevenLabs (voice), Google Gemini (LLM), Twelve Labs (video/code context)
- Full voice-to-code interview loop: speech → transcription → LLM response → TTS — in real time, no polling
- Backend lock prevents concurrent AI responses: one in-flight response at a time, preventing corruption from overlapping streams
- Editor state (code) streamed alongside audio → Gemini receives current code per utterance → contextual follow-ups without manual submission

*Engineering decisions:*
- Single WebSocket connection for all 3 APIs — avoids per-request HTTP overhead, enables low-latency bidirectional flow
- Backend concurrency lock = simple boolean flag — prevents race condition where user speaks again before previous response completes
- Built and shipped in 24 hours by a 2-person team, later adopted by 100+ students at the university level for interview practice

**Bullets (use as-is or adapt):**
- Delivered full voice-to-code interview pipeline in 24 hours by orchestrating 3 external APIs over single WebSocket connection, later used by 100+ students at the university level
- Prevented concurrent response corruption by implementing backend lock ensuring one AI response in-flight at a time
- Achieved real-time code visibility by streaming editor state alongside audio enabling contextual AI follow-up per utterance

**Context for tailoring:**
- Strong signal for real-time systems, WebSocket, AI integration, hackathon execution speed
- Shows multi-API orchestration under time pressure — different signal than Outfitted (depth) vs this (speed + systems thinking)
- Good for roles that mention real-time features, voice/audio, or AI tooling

---

### Flight Fare Prediction — ML Regression
**Date:** December 2025
**Repo:** https://colab.research.google.com/drive/1XbL9oASvXc4yjL4LRTP_F4eYgMLFlmp2
**Stack:** Python, pandas, NumPy, scikit-learn (KNN, Decision Tree, Random Forest, RandomizedSearchCV), seaborn, matplotlib
**Tags:** ML, data science, regression, Python, EDA
**Status:** Personal/self-learning project

**What it does:**
End-to-end ML pipeline predicting Indian domestic flight fares. Raw dataset (13,000+ records) → EDA → feature engineering → model comparison (3 algorithms) → hyperparameter tuning → Random Forest achieving 82% R².

**Technical depth:**

*Dataset:*
- 10,683 train + 2,671 test rows; features: Airline, Date_of_Journey, Source, Destination, Route, Dep_Time, Arrival_Time, Duration, Total_Stops, Additional_Info, Price (target, range ₹1,759–₹79,512)

*EDA + Visualizations:*
- Airline frequency countplot (ranked by volume)
- Max price per airline — Jet Airways Business topped at ₹79,512
- Weekend vs weekday price comparison per airline (bar plot with hue)
- Correlation heatmap across all engineered features

*Feature Engineering:*
- Date_of_Journey → Journey_month, Journey_date (year dropped — single value, zero variance)
- Dep_Time, Arrival_Time → Dep_hour, Dep_min, Arrival_hour, Arrival_min (string split)
- Duration → total minutes: parsed "Xh Ym" format; edge case handled — two records had "5m" only (minutes-only duration), corrected manually before int cast
- Total_Stops → "non-stop" → 0, "X stops" → integer
- Dropped: Route, Additional_Info (low signal); raw string columns dropped post-extraction
- Missing values: Price (2,671 test rows) filled with mean; one null Total_Stops filled with mode

*Encoding:* LabelEncoder on Airline, Source, Destination

*Model comparison:*
| Model | R² |
|---|---|
| KNN Regressor | 58.75% |
| Decision Tree | 66.25% |
| Random Forest | 80.22% |

*Hyperparameter tuning (RandomizedSearchCV on Random Forest):*
- Search space: n_estimators [100–250], max_features ['auto','sqrt'], max_depth [5–20], min_samples_split [2–100], min_samples_leaf [1–10]
- 3-fold CV, 10 candidates, n_jobs=-1
- Best: n_estimators=200, max_depth=15, min_samples_leaf=2
- **Final R²: 82.27%** | MAE: 1,138 | RMSE: 1,922

**Context for tailoring:**
- Full ML pipeline from scratch: EDA → feature engineering → model selection → tuning
- Messy real-world data: mixed datetime formats, free-text duration strings, edge cases
- Model selection discipline: compared 3 algorithms before tuning the best
- Strong signal for data science, ML engineering, and Python-heavy analytics roles

**Bullet variants by role type** *(pick 2–3 most relevant per JD)*

*ML / Data Science:*
- Predicted Indian domestic flight fares with 82% R² by engineering 12 features from raw datetime/string columns and tuning Random Forest via RandomizedSearchCV across 5 hyperparameters on 13,000+ records
- Improved baseline Random Forest R² from 80% to 82% through 3-fold cross-validated hyperparameter search (n_estimators=200, max_depth=15); benchmarked against KNN (59%) and Decision Tree (66%)

*Python / Data Engineering:*
- Cleaned and feature-engineered 13,000+ flight records in pandas — parsed duration strings, extracted datetime components, corrected edge-case malformed entries — reducing nulls to zero before modeling

---

### Music Player System
**Date:** August 2025
**Stack:** Java 17, Spring Boot, WebSockets, Permit.io
**Tags:** backend, real-time, Java, personal project
**Status:** Built

**What it does:**
A real-time music streaming backend — WebSocket-based playback kept in sync across multiple concurrent devices, policy-based authorization on song/playlist actions, and an event-driven queue keeping client state current in real time.

**Technical depth:**
- WebSocket-based playback core achieving sub-200ms playback parity across multiple concurrent devices
- Integrated Permit.io for policy-as-code authorization, securing 6+ discrete actions across song and playlist resources, cutting custom authorization logic
- Event-driven queue system synchronizing 100+ real-time state updates per minute for non-blocking client sync

**Context for tailoring:**
- Strong signal for Java/Spring Boot backend roles and real-time systems (WebSockets)
- Directly relevant for any JD naming Java 17, Spring Boot, or real-time/WebSocket backend work
- Only Java-language project outside of NJIT/BNP work experience — useful when a JD wants Java depth beyond the internships

**Bullet variants by role type** *(pick 2–3 most relevant per JD)*

*Backend / Java:*
- Delivered sub-200ms playback parity across multiple concurrent devices by building a WebSocket-based music streaming core in Spring Boot
- Secured 6+ discrete song and playlist actions by integrating Permit.io policy-as-code authorization, cutting custom authorization logic
- Synchronized 100+ real-time state updates per minute through an event-driven queue system, keeping playback non-blocking across clients
