Introduction
Serplify is a SERP intelligence and traffic platform. A single account and a single prepaid balance give you three products:

Product	What it does	Price
SERP API	Real-time Google SERP data as JSON	$0.005 / successful SERP
Website traffic	Real visits from organic & social sources	$0.002 / delivered visit
SEO traffic (CTR)	Real human SERP clicks (organic CTR)	$0.04 / delivered click
You only pay for successful results — a blocked or failed SERP fetch costs nothing, and you are billed on delivered visits/clicks, never on impressions.

Base URL
https://api.serplify.io

The two API surfaces
Serplify runs one crawl + parse engine behind two public API surfaces:

Native /v1 (recommended)
The modern Serplify contract:

Real HTTP status codes (200, 202, 400, 401, 402, 404, 422, 429, 5xx).
A single flat response envelope: { request_id, status, meta, data }.
A flat error object: { "error": { "code", "message" } }.
Structured requests (location, language, format, track, webhook).
First-class rank tracking via track.
Use /v1 for all new integrations. Everything in these docs describes /v1 unless a page is marked otherwise.

DataForSEO-compatible /v3 (legacy drop-in)
Byte-compatible with DataForSEO’s Google Organic SERP endpoints (the double tasks[].result[] envelope, HTTP-200-always, 5-digit status codes). If you are migrating from DataForSEO you can point your existing client at Serplify by changing only the base URL. See DataForSEO drop-in.

Next steps
Quickstart — your first SERP in under a minute.
Authentication — API keys.
Pricing & wallet — how billing works.
SERP API overview — the full reference.

Quickstart
1. Get an API key
Create an account at app.serplify.io (email magic link — no password) and you start with $1 of free balance. Open API keys → Create key and copy the key — it is shown once.

Keys look like live_… (production) or test_….

2. Make a live SERP request
Terminal window
curl -X POST https://api.serplify.io/v1/serp/search \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT" \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "best running shoes",
    "location": { "code": 2840 },
    "language": { "code": "en" },
    "device": "desktop",
    "format": "advanced"
  }'

3. Read the response
{
  "request_id": "req_9f2c…",
  "status": "ok",
  "meta": { "api_version": "0.1.0", "time": 1.13, "cost": 0.005, "currency": "USD" },
  "data": {
    "keyword": "best running shoes",
    "search_engine": "google",
    "search_engine_domain": "google.com",
    "device": "desktop",
    "location": { "code": 2840, "name": "United States" },
    "language": { "code": "en", "name": "English" },
    "result_url": "https://www.google.com/search?q=best+running+shoes",
    "fetched_at": "2026-07-02T12:00:00.000Z",
    "total_results_count": 1240000000,
    "pages_crawled": 1,
    "items_count": 42,
    "feature_types": ["organic", "paid", "people_also_ask", "related_searches"],
    "items": [ /* … SERP items … */ ]
  }
}

Language & runtime examples
Node.js (fetch)
const res = await fetch("https://api.serplify.io/v1/serp/search", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SERPLIFY_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    keyword: "best running shoes",
    location: { code: 2840 },
    language: { code: "en" },
    format: "advanced",
  }),
});
const body = await res.json();
console.log(body.data.items);

Python (requests)
import os, requests

res = requests.post(
    "https://api.serplify.io/v1/serp/search",
    headers={"Authorization": f"Bearer {os.environ['SERPLIFY_KEY']}"},
    json={
        "keyword": "best running shoes",
        "location": {"code": 2840},
        "language": {"code": "en"},
        "format": "advanced",
    },
)
res.raise_for_status()
print(res.json()["data"]["items"])

What next?
Prefer async at scale? Use tasks.
Track rankings over time with rank tracking.
Understand every field in the response format.

Authentication
Every Serplify API request is authenticated with an API key sent as a Bearer token in the Authorization header.

Terminal window
Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT

Getting a key
Sign in at app.serplify.io.
Go to API keys.
Create key — pick a label and live or test prefix.
Copy the key immediately. The plaintext is shown once and never again.
Keys are scoped to your account and share your account’s single prepaid balance. You can create multiple keys (e.g. per environment or per service) and revoke or reactivate any of them at any time.

Missing or invalid keys
On the native /v1 API, an authentication failure returns a real HTTP status:

HTTP 401
{ "error": { "code": "unauthorized", "message": "Missing or invalid API key." } }

Situation	HTTP	error.code
No Authorization header	401	unauthorized
Unknown / revoked key	401	unauthorized
Balance too low for the request	402	insufficient_balance
DataForSEO drop-in

The legacy /v3 API mirrors DataForSEO: it always returns HTTP 200 and carries the real status in the body (40101 auth error, 40402 insufficient funds). See the migration guide.

Keeping keys safe
Never embed a live_ key in client-side code or a public repo.
Use test_ keys in development.
Revoke a key the moment it may have leaked — revocation is instant.

Pricing & wallet
Serplify uses one prepaid balance shared across all three products. You add funds once and spend them on SERP requests, website visits, or SEO clicks at one transparent per-success rate each.

Rates
Product	Rate	Per 1,000	Billed when
SERP API	$0.005	$5	a SERP completes successfully (a full page, up to 100 results)
Website traffic	$0.002	$2	a real visit is delivered
SEO traffic (CTR)	$0.04	$40	a real human click is delivered
Your $1 of free starting credit is available for SERP API testing and covers roughly 200 successful SERPs. Website Traffic and SEO Traffic become available after your first top-up.

Pay only for wins
A blocked or failed SERP fetch costs nothing.
You are billed on delivered visits and clicks, never on impressions or attempts.
Your balance never expires and does not reset monthly.
How a SERP charge appears
Each successful SERP response reports its charge inline:

"meta": { "cost": 0.005, "currency": "USD", "time": 1.13, "api_version": "0.1.0" }

For async tasks the charge is applied when the task is accepted (enqueued), the same way it appears on the task-accepted response.

Balance & top-ups
Manage your balance in app.serplify.io → Billing:

Top-up	Bonus
$25	—
$100	—
$250	+5%
$1,000	+10%
Every credit and debit is recorded on an append-only ledger you can review in Billing → Transactions.

Insufficient balance
If a request would take your balance below zero, the native API rejects it:

HTTP 402
{ "error": { "code": "insufficient_balance", "message": "Your prepaid balance is too low for this request." } }

Top up and retry.

Errors
The native /v1 API uses real HTTP status codes and a flat, machine-readable error body:

{
  "error": {
    "code": "insufficient_balance",
    "message": "Your prepaid balance is too low for this request."
  },
  "request_id": "req_9f2c…"
}

error.code is a stable snake_case string you switch on. It will not change.
error.message is human-readable and may change — do not parse it.
request_id correlates the failure with your logs and Serplify support.
Validation errors also include error.details: an array of { field, message } entries.
Error codes
HTTP	error.code	Meaning
400	bad_request	Malformed request body or parameters.
401	unauthorized	Missing or invalid API key.
402	insufficient_balance	Prepaid wallet balance too low for the request.
402	budget_exceeded	The API key’s monthly spend limit has been reached.
403	forbidden	The key may not access the resource.
404	not_found	Resource (e.g. a task id) not found.
422	invalid_location	The location could not be resolved.
422	invalid_language	The language could not be resolved.
422	invalid_keyword	The keyword is missing or invalid.
429	rate_limited	Too many requests — slow down and retry.
202	task_not_ready	Async task is still processing (see tasks).
502	task_failed	The SERP/task could not be completed.
500	internal_error	Unexpected server error.
Validation example
HTTP 400
{
  "error": {
    "code": "bad_request",
    "message": "Invalid request body.",
    "details": [
      { "field": "keyword", "message": "String must contain at least 1 character(s)" },
      { "field": "location", "message": "location requires one of code, name, or coordinate." }
    ]
  },
  "request_id": "req_9f2c…"
}

Retrying
429 and 5xx are safe to retry with exponential backoff.
402 insufficient_balance means top up your wallet first, then retry.
402 budget_exceeded means the key hit its monthly cap — raise the cap or wait for the rolling 30-day window to free up, then retry.
4xx validation errors (400, 422) will keep failing until the request is corrected — do not blind-retry them.

SERP API overview
The native SERP API returns real-time Google Search results as clean JSON. It runs live (synchronous) or async (task-based) over the same engine.

Endpoints
Method	Path	Purpose
POST	/v1/serp/search	Live SERP — one request, one result, inline
POST	/v1/serp/tasks	Enqueue an async task
GET	/v1/serp/tasks	List your completed (ready) tasks
GET	/v1/serp/tasks/{id}	Fetch a task’s result
GET	/v1/serp/track	Rank-over-time for a tracked target
GET	/v1/locations	Supported locations
GET	/v1/locations/{country}	Locations for one ISO country
GET	/v1/languages	Supported languages
All endpoints require authentication.

Request shape
POST /v1/serp/search and POST /v1/serp/tasks share the same request body:

Field	Type	Required	Default	Notes
keyword	string	yes	—	1–700 chars. The search query.
location	object	yes	—	One of code, name, or coordinate.
language	object	yes	—	One of code or name.
device	desktop | mobile	no	desktop	
os	windows | macos | android | ios	no	windows	
depth	integer	no	100	Results to return, 10–100. Higher values are clamped to 100.
format	standard | advanced | html	no	advanced	Response detail.
search_engine_domain	string	no	google.com	e.g. google.co.uk.
url	string	no	—	Pre-built Google URL; overrides keyword/location/device.
stop_on_match	array	no	—	Stop crawling once a target is matched.
track	object	no	—	Rank tracking — { target, label? }.
webhook	object	no	—	Async webhooks (tasks only).
priority	standard | priority	no	standard	priority jumps the queue.
tag	string	no	—	Free-form label echoed back.
location
{ "code": 2840 }                              // by numeric code (recommended)
{ "name": "London,England,United Kingdom" }   // by canonical name
{ "coordinate": "51.5074,-0.1278,10" }        // lat,lng,radius(km)

language
{ "code": "en" }        // ISO code (recommended)
{ "name": "English" }   // human name

Look up valid values via /v1/locations and /v1/languages.

Response envelope
Every successful native response uses the same envelope:

{
  "request_id": "req_…",
  "status": "ok",
  "meta": { "api_version": "0.1.0", "time": 1.13, "cost": 0.005, "currency": "USD" },
  "data": { /* endpoint-specific payload */ }
}

Field	Meaning
request_id	Correlation id — echo to support.
status	ok (data present) or accepted (async task still processing).
meta.time	Server processing time (seconds).
meta.cost	Amount drawn from your balance (USD).
data	The result — shape depends on the endpoint and format.
Errors use a different shape — see Errors.

Live search
POST /v1/serp/search runs a Google SERP synchronously and returns the parsed result inline. It is the fastest way to get a single SERP — typically ~1 second.

Request
Terminal window
curl -X POST https://api.serplify.io/v1/serp/search \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT" \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "coffee shops",
    "location": { "name": "London,England,United Kingdom" },
    "language": { "code": "en" },
    "device": "mobile",
    "format": "advanced",
    "depth": 20
  }'

See the request shape for every field.

Response
HTTP 200 with a SERP result in data:

{
  "request_id": "req_…",
  "status": "ok",
  "meta": { "api_version": "0.1.0", "time": 1.02, "cost": 0.005, "currency": "USD" },
  "data": {
    "keyword": "coffee shops",
    "search_engine": "google",
    "device": "mobile",
    "location": { "code": 2826, "name": "London,England,United Kingdom" },
    "language": { "code": "en", "name": "English" },
    "result_url": "https://www.google.co.uk/search?q=coffee+shops",
    "fetched_at": "2026-07-02T12:00:00.000Z",
    "total_results_count": 512000000,
    "pages_crawled": 1,
    "items_count": 38,
    "feature_types": ["local_pack", "organic", "people_also_ask"],
    "items": [ /* … */ ]
  }
}

Formats
format controls the detail level of data.items:

advanced (default) — every parsed SERP feature type.
standard — organic, paid, and featured-snippet items only.
html — raw page HTML instead of parsed items (see response format).
If the SERP can’t finish in time
If a live request cannot complete within the synchronous budget, it is transparently promoted to an async task and returns HTTP 202:

HTTP 202
{
  "request_id": "req_…",
  "status": "accepted",
  "meta": { "api_version": "0.1.0", "time": 15.0, "cost": 0.005, "currency": "USD" },
  "data": {
    "task_id": "…",
    "keyword": "coffee shops",
    "format": "advanced",
    "status_url": "/v1/serp/tasks/…"
  }
}

Poll status_url (see tasks) to retrieve the result. From that moment the request bills exactly like an async task: the task price (cost in the 202 response) is the single charge — you are never billed the live price on top, and fetching the result is free.

Errors
Failures use the standard error contract, e.g. 422 invalid_location, 402 insufficient_balance, or 502 task_failed.

Async tasks
For bulk or high-throughput workloads, enqueue SERP tasks and collect the results later — by polling or via webhooks.

Enqueue a task
POST /v1/serp/tasks takes the same body as live search and returns HTTP 202:

Terminal window
curl -X POST https://api.serplify.io/v1/serp/tasks \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT" \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "electric cars",
    "location": { "code": 2840 },
    "language": { "code": "en" },
    "format": "advanced",
    "priority": "priority",
    "webhook": { "result_url": "https://example.com/hooks/serplify?id=$id" }
  }'

HTTP 202
{
  "request_id": "req_…",
  "status": "accepted",
  "meta": { "api_version": "0.1.0", "time": 0.02, "cost": 0.005, "currency": "USD" },
  "data": {
    "task_id": "0199…",
    "keyword": "electric cars",
    "format": "advanced",
    "status_url": "/v1/serp/tasks/0199…"
  }
}

The charge is applied at enqueue. priority: "priority" makes the task jump the queue ahead of standard tasks.

Fetch a task
GET /v1/serp/tasks/{id} returns the result once ready. An optional ?format= query (standard | advanced | html) overrides the stored format on read.

Terminal window
curl https://api.serplify.io/v1/serp/tasks/0199… \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT"

Still processing → HTTP 202:

{
  "request_id": "req_…",
  "status": "accepted",
  "meta": { "api_version": "0.1.0", "time": 0.01, "cost": 0, "currency": "USD" },
  "data": { "task_id": "0199…", "status": "processing", "status_url": "/v1/serp/tasks/0199…" }
}

Ready → HTTP 200 with the SERP result in data.

Failed → HTTP 502 task_failed.

Unknown id → HTTP 404 not_found.

List ready tasks
GET /v1/serp/tasks lists your completed tasks from the last 24 hours:

{
  "request_id": "req_…",
  "status": "ok",
  "meta": { "api_version": "0.1.0", "time": 0.03, "cost": 0, "currency": "USD" },
  "data": {
    "tasks": [
      { "task_id": "0199…", "keyword": "electric cars", "tag": null, "created_at": "2026-07-02T12:00:00.000Z", "status_url": "/v1/serp/tasks/0199…" }
    ]
  }
}

Polling vs webhooks
Polling — fetch status_url on an interval (e.g. every 2–5s). Fetching a task is free.
Webhooks — set webhook.ready_url and/or webhook.result_url at enqueue to be notified/pushed the result. See webhooks.

Response format
The data payload of a SERP response (from live search or a completed task) uses these fields:

Field	Type	Notes
keyword	string	The query that was searched.
search_engine	"google"	Always google today.
search_engine_domain	string	e.g. google.com, google.co.uk.
device	desktop | mobile	Device the SERP was rendered for.
location	{ code, name }	Resolved location.
language	{ code, name }	Resolved language.
result_url	string	The Google URL that was fetched.
fetched_at	string (ISO 8601)	When the SERP was captured.
total_results_count	integer	Google’s reported total, when present.
pages_crawled	integer	SERP pages fetched.
items_count	integer	Number of items in items.
feature_types	string[]	Distinct SERP feature types present.
spelling	object | null	Spelling correction/suggestion, if any.
items	array	The SERP items (see below).
tracked_rank	object | null	Present when track was requested — see rank tracking.
Items
Every entry in items is a typed SERP element discriminated by type (e.g. organic, paid, local_pack, people_also_ask). All items share a ranking triplet:

Field	Meaning
type	The feature type.
rank_absolute	Position across the whole SERP (1 = top element).
rank_group	Position within the item’s own type group.
page	Which SERP page the item appeared on.
Organic item example
{
  "type": "organic",
  "rank_group": 1,
  "rank_absolute": 3,
  "page": 1,
  "domain": "nike.com",
  "title": "Nike Running Shoes",
  "description": "Shop the latest running shoes …",
  "url": "https://www.nike.com/running",
  "breadcrumb": "nike.com › running",
  "highlighted": ["running", "shoes"],
  "rating": { "rating_type": "AggregateRating", "value": 4.6, "votes_count": 1203, "rating_max": 5 }
}

Field availability varies by type — see the full list of feature types.

Formats
The format request field controls which items appear:

advanced (default) — every parsed feature type.
standard — organic, paid, and featured-snippet items only; items are re-ranked over the filtered subset. Use this when you only care about the classic “ten blue links” plus ads.
HTML format
With format: "html", data instead contains the raw page HTML:

{
  "keyword": "coffee shops",
  "search_engine": "google",
  "search_engine_domain": "google.com",
  "device": "desktop",
  "location": { "code": 2840, "name": "United States" },
  "language": { "code": "en", "name": "English" },
  "result_url": "https://www.google.com/search?q=coffee+shops",
  "fetched_at": "2026-07-02T12:00:00.000Z",
  "pages": [ { "page": 1, "html": "<!doctype html>…" } ]
}

SERP feature types
format: "advanced" returns every SERP feature Serplify detects. Each item is discriminated by its type and carries the shared ranking fields (rank_absolute, rank_group, page).

Fully-typed features
These types have rich, stable, documented fields:

type	Description	Notable fields
organic	Classic organic result	domain, title, description, url, breadcrumb, highlighted, links, rating, price, images, faq
paid	Paid ad	domain, title, description, url, breadcrumb, description_rows, price, rating
featured_snippet	Answer box pulled from a page	domain, title, description, url, featured_title, table
ai_overview	Google AI Overview	items[] (text/markdown/links/images/references), references[], asynchronous_ai_overview
people_also_ask	”People also ask” accordion	items[] with title, seed_question, expanded_element[]
related_searches	Related search chips	items[] (strings)
refinement_chips	Refinement/filter chips	items[] with title, options[]
knowledge_graph	Knowledge panel	title, subtitle, description, url, image_url, cid, items[]
local_pack	Google Business (map 3-pack)	title, description, domain, phone, url, rating, cid
GMB rank tracking

Each business in the local pack is its own local_pack item and exposes cid (Google Maps customer id) — the most stable identifier for tracking a business’s map rank. Combine with rank tracking.

Additional detected features
These are also returned when present, with a common, flexible field set (title, description, url, items[], images[], rating, price, and type-specific extras):

images, video, short_videos, top_stories, twitter, map, shopping, popular_products, answer_box, currency_box, math_solver, people_also_search, jobs, events, recipes, carousel, multi_carousel, mention_carousel, app, commercial_units, compare_sites, courses, discussions_and_forums, explore_brands, find_results_on, found_on_web, google_flights, google_hotels, google_posts, google_reviews, hotels_pack, knowledge_graph_expanded_item, knowledge_graph_images_item, local_services, perspectives, product_considerations, questions_and_answers, scholarly_articles, third_party_reviews, top_sights.

Working with mixed types
Because items is a mixed list, switch on type:

for (const item of data.items) {
  switch (item.type) {
    case "organic":
      console.log(item.rank_absolute, item.domain, item.url);
      break;
    case "local_pack":
      console.log("GMB:", item.title, item.cid);
      break;
    case "people_also_ask":
      console.log("PAA questions:", item.items?.map((q) => q.title));
      break;
  }
}

Use feature_types on the result to see which types are present before iterating.

Rank tracking
Rank tracking is a first-class Serplify feature with no DataForSEO equivalent. Attach a track block to any SERP request and Serplify records a rank snapshot for your target when the SERP completes. Query the history any time via GET /v1/serp/track.

Record a snapshot
Add track to a live search or task request:

{
  "keyword": "best running shoes",
  "location": { "code": 2840 },
  "language": { "code": "en" },
  "track": { "target": "nike.com", "label": "nike-brand" }
}

target — the domain/host to track (e.g. nike.com). https://, www., and any path are stripped for matching.
label — optional grouping label (e.g. a project name).
track works with the standard and advanced formats. It cannot be combined with format: "html" (raw HTML is never parsed, so there is no rank to record) — that combination is rejected with 400 bad_request.

The synchronous response also includes the target’s rank inline:

"tracked_rank": {
  "target": "nike.com",
  "rank_absolute": 3,
  "rank_group": 1,
  "url": "https://www.nike.com/running",
  "found": true
}

When the target is not on the SERP, found is false and the ranks are null — a snapshot is still recorded so gaps are visible in the history.

Query rank-over-time
GET /v1/serp/track returns your snapshots for a target, newest first.

Terminal window
curl "https://api.serplify.io/v1/serp/track?keyword=best%20running%20shoes&target=nike.com&location_code=2840&language_code=en&device=desktop" \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT"

Query param	Required	Notes
keyword	yes	The tracked keyword.
target	yes	The tracked domain/host.
location_code	no	Filter by location.
language_code	no	Filter by language.
device	no	desktop or mobile.
limit	no	Max snapshots (1–1000, default 100).
{
  "request_id": "req_…",
  "status": "ok",
  "meta": { "api_version": "0.1.0", "time": 0.02, "cost": 0, "currency": "USD" },
  "data": {
    "keyword": "best running shoes",
    "target": "nike.com",
    "location_code": 2840,
    "language_code": "en",
    "device": "desktop",
    "snapshots": [
      { "captured_at": "2026-07-02T12:00:00.000Z", "rank_absolute": 3, "rank_group": 1, "url": "https://www.nike.com/running" },
      { "captured_at": "2026-07-01T12:00:00.000Z", "rank_absolute": 5, "rank_group": 2, "url": "https://www.nike.com/running" }
    ]
  }
}

Building a daily rank tracker
Once a day, enqueue a task per keyword with track set.
Let webhooks or polling collect results — snapshots are written automatically.
Chart the trend with GET /v1/serp/track.
Querying history is free; you are only charged for the SERP requests that produce the snapshots.

Webhooks
Async tasks can notify you (or push the full result) on completion instead of being polled. Configure webhooks with the webhook block at enqueue.

{
  "keyword": "electric cars",
  "location": { "code": 2840 },
  "language": { "code": "en" },
  "format": "advanced",
  "webhook": {
    "ready_url": "https://example.com/hooks/ready?id=$id&tag=$tag",
    "result_url": "https://example.com/hooks/result?id=$id",
    "result_format": "advanced"
  }
}

Field	Method	Payload
ready_url	GET	No body — a ping telling you the task is ready to fetch.
result_url	POST	The full native envelope for the completed task.
result_format	—	standard | advanced | html for the result_url payload (defaults to the task’s format).
URL placeholders
Both URLs support literal placeholders that Serplify substitutes:

$id — the task id.
$tag — the request tag (empty if none).
result_url payload
The POST body is the same native envelope you’d get from GET /v1/serp/tasks/{id}:

{
  "request_id": "req_…",
  "status": "ok",
  "meta": { "api_version": "0.1.0", "time": 0, "cost": 0, "currency": "USD" },
  "data": { "keyword": "electric cars", "search_engine": "google", "items": [ /* … */ ] }
}

Delivery & reliability
Webhooks are best-effort with retries — a delivery that returns non-2xx or times out is retried with backoff.
Respond quickly with a 2xx; do heavy processing asynchronously on your side.
Webhooks never affect task billing or state — a failed webhook does not fail the task, and the result remains fetchable via GET /v1/serp/tasks/{id}.
Treat ready_url/result_url as best-effort signals and reconcile with a periodic GET /v1/serp/tasks sweep if you need exactly-once guarantees.

Locations & languages
SERP requests need a location and a language. Resolve the exact codes with these reference endpoints.

location_code is Google’s geo target criteria ID (e.g. 2840 = United States) and the language codes are Google’s language identifiers, so any mapping you already keep against Google’s codes works as-is.

Locations
GET /v1/locations lists supported Google locations.

Query param	Notes
country	Filter by ISO-3166 alpha-2 (e.g. US, GB).
limit	Max rows (1–5000, default 5000).
offset	Pagination offset.
Terminal window
curl "https://api.serplify.io/v1/locations?country=GB&limit=5" \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT"

{
  "request_id": "req_…",
  "status": "ok",
  "meta": { "api_version": "0.1.0", "time": 0.05, "cost": 0, "currency": "USD" },
  "data": {
    "total": 950,
    "locations": [
      { "code": 2826, "name": "United Kingdom", "country": "GB", "type": "Country", "parent_code": null },
      { "code": 1006886, "name": "London,England,United Kingdom", "country": "GB", "type": "City", "parent_code": 20339 }
    ]
  }
}

GET /v1/locations/{country} returns all locations for one ISO country:

Terminal window
curl https://api.serplify.io/v1/locations/us \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT"

Languages
GET /v1/languages lists supported languages.

Terminal window
curl https://api.serplify.io/v1/languages \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT"

{
  "request_id": "req_…",
  "status": "ok",
  "meta": { "api_version": "0.1.0", "time": 0.02, "cost": 0, "currency": "USD" },
  "data": {
    "languages": [
      { "code": "en", "name": "English" },
      { "code": "es", "name": "Spanish" }
    ]
  }
}

Using the values
Pass the code (or name) into a SERP request:

{
  "keyword": "coffee",
  "location": { "code": 1006886 },
  "language": { "code": "en" }
}

Reference lookups are free.

Traffic API overview
The Traffic API delivers real human traffic — driven by genuine browsers through residential/mobile proxies — on the same prepaid balance as the SERP API. Two products:

Product	Endpoint	What it delivers	Price
Website traffic	POST /v1/traffic/visits	Real visits with a controlled referrer (organic/social/direct)	$0.002 / delivered visit
SEO traffic (CTR)	POST /v1/traffic/clicks	Real Google SERP searches that find and click your URL	$0.04 / delivered click
Both create a campaign that runs asynchronously; you poll its status, watch it in app.serplify.io under Projects, or receive a completion webhook.

Account funding

Traffic campaigns require one completed top-up. The complimentary $1 starting balance remains available for testing the SERP API.

Endpoints
Method	Path	Purpose
POST	/v1/traffic/visits	Create a website-traffic campaign
POST	/v1/traffic/clicks	Create an SEO/CTR click campaign
GET	/v1/traffic/campaigns/{id}	Campaign status (delivered / failed / status)
POST	/v1/traffic/campaigns/{id}/pause	Pause delivery
POST	/v1/traffic/campaigns/{id}/resume	Resume a paused campaign
POST	/v1/traffic/campaigns/{id}/cancel	Stop and cancel remaining work
How a campaign runs
Under the hood each campaign becomes a queue of individual visit/click tasks that a pool of browser workers claims and executes with retries and lease-based recovery — so a large campaign delivers steadily over time, and worker restarts never lose or double-run work.

Webhooks
Pass webhook_url when creating a campaign and Serplify POSTs it for the events you subscribe to via webhook_events (default: ["completed"]):

Event	When	Frequency
completed	the whole campaign finishes	once (reliably retried)
delivered	each successful visit/click	per delivery (best-effort)
paused	the campaign auto-pauses (e.g. balance ran out)	on pause (best-effort)
Create with all events
{
  "url": "https://example.com",
  "quantity": 1000,
  "webhook_url": "https://you.example.com/hooks/serplify",
  "webhook_events": ["delivered", "paused", "completed"]
}

Every callback body carries an event field:

completed
{ "event": "completed", "campaign_id": "…", "product": "clicks", "status": "completed", "quantity": 200, "delivered": 187, "failed": 13 }

delivered
{ "event": "delivered", "campaign_id": "…", "product": "visits", "status": "running", "quantity": 1000, "delivered": 42, "failed": 1, "result": { "target": "example.com", "duration_seconds": 63 } }

paused
{ "event": "paused", "campaign_id": "…", "product": "clicks", "status": "paused", "quantity": 1000, "delivered": 120, "failed": 4, "reason": "insufficient_balance" }

Tip

delivered fires once per result — on a large campaign that’s a lot of calls. Subscribe to it only if you need real-time per-result tracking; otherwise completed (plus polling GET /v1/traffic/campaigns/{id}) is lighter.

Availability

The Traffic API and its execution engine are rolling out behind a feature flag. Campaign management (create, list, status) is stable; live delivery is enabled per-account as the engine is provisioned. Check your account or contact support for access.

Campaign response
Creating a campaign returns HTTP 202 with a campaign record:

{
  "request_id": "req_…",
  "status": "accepted",
  "meta": { "api_version": "0.1.0", "time": 0.03, "cost": 0, "currency": "USD" },
  "data": {
    "campaign_id": "…",
    "name": "Visits: https://example.com",
    "product": "visits",
    "quantity": 1000,
    "delivered": 0,
    "failed": 0,
    "status": "running",
    "status_url": "/v1/traffic/campaigns/…",
    "created_at": "2026-07-02T12:00:00.000Z"
  }
}

name is what the campaign is called in the dashboard. Set it yourself on clicks campaigns with the name field; otherwise it is derived from the keyword or URL.

Clicks campaigns also carry a keywords array with per-keyword progress, including which keywords can never deliver — see tracking progress per keyword.

Billing
You are charged per delivered result (visit or click), never on the requested quantity up front and never on failed deliveries. Delivery draws down your prepaid balance as it happens; the campaign’s delivered count is the source of truth for what you paid.

If your balance runs out mid-campaign, delivery auto-pauses — the campaign goes to paused and stops spending. Top up and resume it (or it resumes on the next top-up) to finish the remaining work. You are never charged past your balance.

Responsible use
Serplify provides real signal and real data so you can test CTR, dwell time, referral behaviour, and search visibility at scale. It does not promise ranking manipulation, and you must own or be authorised to send traffic to the target URLs. See the Acceptable Use policy.

Website traffic
POST /v1/traffic/visits delivers real page visits to a URL, with a controlled referral source, geo/device targeting, and human-like dwell and browsing. Billed $0.002 per delivered visit.

Request
Terminal window
curl -X POST https://api.serplify.io/v1/traffic/visits \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/landing",
    "quantity": 5000,
    "source": "facebook",
    "geo": { "country": "US" },
    "device": "mixed",
    "dwell_seconds_min": 20,
    "dwell_seconds_max": 90,
    "bounce_rate": 0.4,
    "pages_per_visit": 3
  }'

Field	Type	Required	Default	Notes
url	string (URL)	yes	—	Destination the visit lands on.
quantity	integer	yes	—	Visits to deliver (1–1,000,000).
source	enum	no	organic	organic, direct, facebook, twitter, reddit, pinterest, linkedin, youtube, referral.
referrer	string (URL)	no	—	Custom referrer (for source: "referral").
geo	object	no	—	{ country? } — ISO-3166 alpha-2, country-level targeting.
device	enum	no	mixed	desktop, mobile, mixed.
pacing	enum	no	asap	asap delivers as fast as capacity allows; distributed spreads delivery naturally over spread_hours.
spread_hours	integer	no	24	For pacing: "distributed": spread the quantity over this many hours (1–720).
dwell_seconds_min / dwell_seconds_max	integer	no	15 / 60	Time on the landing page.
bounce_rate	number	no	0.5	Fraction (0–1) that bounce after landing.
pages_per_visit	integer	no	1	Internal pages browsed (1 = landing only).
tag	string	no	—	Free-form label.
Response
HTTP 202 with a campaign whose product is visits. Poll status_url to watch delivered climb.

How visits behave
Each visit is a real browser page load, so client-side analytics (GA4, etc.) register it.
The referral source shapes the Referer and navigation pattern so the visit attributes to the chosen channel.
geo and device route the visit through matching residential/mobile proxies.
dwell_*, bounce_rate, and pages_per_visit shape realistic engagement.
You are charged only for visits actually delivered.

SEO traffic (CTR)
POST /v1/traffic/clicks runs real Google searches from genuine browsers, finds your target URL in the results, and clicks it — then browses with natural dwell. Use it to test organic CTR, dwell time, and search visibility. Billed $0.04 per delivered click.

Request
Terminal window
curl -X POST https://api.serplify.io/v1/traffic/clicks \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme — running shoes cluster",
    "keywords": [
      "best running shoes",
      "trail running shoes",
      "cheap running shoes"
    ],
    "target": "example.com",
    "quantity": 200,
    "geo": { "country": "US" },
    "device": "mobile",
    "search_max_pages": 5,
    "dwell_seconds_min": 40,
    "dwell_seconds_max": 120,
    "pages_per_visit": 2
  }'

Field	Type	Required	Default	Notes
keywords	string[] | object[]	yes*	—	Up to 50 queries in one campaign. Strings split quantity evenly; objects { keyword, quantity } set each share explicitly.
keyword	string	yes*	—	Single query. Send this or keywords, never both.
name	string	no	Clicks: <first keyword>	Campaign name as it appears in the dashboard.
target	string	yes	—	URL/domain to find and click in the SERP.
quantity	integer	yes	—	Clicks to deliver (1–1,000,000), across all keywords. Must be ≥ the number of keywords.
geo	object	no	—	{ country? } — ISO-3166 alpha-2, country-level targeting.
device	enum	no	mixed	desktop, mobile, mixed.
pacing	enum	no	asap	asap delivers as fast as capacity allows; distributed spreads clicks naturally over spread_hours.
spread_hours	integer	no	24	For pacing: "distributed": spread the clicks over this many hours (1–720).
search_max_pages	integer (1–10)	no	5	How deep into the SERP to look for and deliver the target. A shallow 1–3-page miss is not enough evidence for the automatic not-ranking guard.
dwell_seconds_min / dwell_seconds_max	integer	no	30 / 120	Time on the clicked page.
pages_per_visit	integer	no	2	Internal pages browsed after the click.
tag	string	no	—	Free-form label.
* Exactly one of keywords or keyword is required.

Daily campaign creation limit
An account may create up to 25 SEO traffic projects per UTC day by default. The counter is shared by dashboard projects and Traffic API campaigns. Deleting a project does not refund its creation slot; failed requests do not consume one. Operators can change the runtime limit, and 0 disables rejection.

One campaign per URL, not per keyword
If a page targets several queries, send them as keywords in a single request. You get one campaign to name, watch and poll instead of one per keyword — which matters at volume: 150 URLs × 6 keywords is 900 campaigns if you split them, and 150 if you don’t.

quantity is the total across the campaign and is split evenly, remainder first, so the parts always sum to what you bought. quantity: 200 over 3 keywords gives 67 / 67 / 66.

Weighting keywords
A head term and a long-tail term rarely deserve the same number of clicks, so you can set each share yourself:

{
  "name": "Acme — running shoes cluster",
  "quantity": 100,
  "keywords": [
    { "keyword": "best running shoes",  "quantity": 70 },
    { "keyword": "trail running shoes", "quantity": 20 },
    { "keyword": "cheap running shoes", "quantity": 10 }
  ]
}

Set quantity on every keyword or on none — mixing the two is rejected, because guessing a share for the unset ones would change what you bought for the ones you did specify. Explicit shares must sum exactly to the campaign quantity, so a campaign can never quietly under-deliver what you paid for.

Response
HTTP 202 with a campaign whose product is clicks. A click is only counted (and billed) when the browser actually finds the target within search_max_pages and clicks through — if the target isn’t found on a given attempt, you are not charged for it.

Tracking progress per keyword
GET /v1/traffic/campaigns/{id} returns a keywords array alongside the campaign totals:

{
  "campaign_id": "9f1c…",
  "name": "Acme — running shoes cluster",
  "product": "clicks",
  "quantity": 200,
  "delivered": 118,
  "status": "running",
  "keywords": [
    { "keyword": "best running shoes",  "quantity": 67, "delivered": 67, "status": "completed" },
    { "keyword": "trail running shoes", "quantity": 67, "delivered": 51, "status": "delivering" },
    { "keyword": "cheap running shoes", "quantity": 66, "delivered": 0,  "status": "not_ranking" }
  ]
}

Keyword status	Meaning
delivering	Working through its share of the quantity.
completed	Delivered its full share.
not_ranking	Repeated searches could not find your target within search_max_pages, so this keyword was switched off. It will never deliver — replace it, or raise search_max_pages. You were not charged for those searches.
not_ranking is the one to watch if you generate keywords programmatically: it is the difference between a campaign that is merely slow and one that can never finish. A campaign whose remaining keywords are all not_ranking will stop short of quantity, and the unspent balance stays on your account.

What you get
A genuine browser performs the search, so the click is a real organic SERP interaction (not a synthetic hit on your URL).
Natural dwell and post-click browsing produce realistic engagement signals.
geo/device route through matching residential/mobile proxies.
Responsible use
This is a measurement and testing tool. Serplify does not guarantee ranking changes, and you must be authorised to drive traffic to the target. See the Acceptable Use policy.

DataForSEO drop-in
Already integrated with DataForSEO? Serplify’s /v3 API is a drop-in replacement for DataForSEO’s Google Organic SERP endpoints. Keep your code, keep your request/response parsing — just change the base URL and use a Serplify API key.

Note

This page describes the legacy /v3 compatibility surface. For new work, prefer the native /v1 API — it has real HTTP status codes, a cleaner envelope, and rank tracking.

What changes
DataForSEO	Serplify drop-in
Base URL	https://api.dataforseo.com	https://api.serplify.io
Auth	Basic auth (login:password)	Authorization: Bearer live_…
Endpoints	/v3/serp/google/organic/*	identical paths
Envelope	tasks[].result[], HTTP 200 always	identical
Status codes	5-digit (20000, 40101, …)	identical
Everything else — the request array shape, location_code/language_code, live/{regular,advanced,html}, task_post → tasks_ready → task_get, pingback/postback — matches.

Supported /v3 endpoints
Method	Path
POST	/v3/serp/google/organic/task_post
POST	/v3/serp/google/organic/live/regular
POST	/v3/serp/google/organic/live/advanced
POST	/v3/serp/google/organic/live/html
GET	/v3/serp/google/organic/task_get/{regular,advanced,html}/{id}
GET	/v3/serp/google/organic/tasks_ready
GET	/v3/serp/google/locations · /v3/serp/google/locations/{country_iso}
GET	/v3/serp/google/languages
Example
Terminal window
curl -X POST https://api.serplify.io/v3/serp/google/organic/live/advanced \
  -H "Authorization: Bearer live_AG-qwBgCtZkBfHHjHtOcOYS9rNEczyOT" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "keyword": "best running shoes",
      "location_code": 2840,
      "language_code": "en",
      "device": "desktop"
    }
  ]'

The response is the familiar DataForSEO envelope:

{
  "version": "0.1.0",
  "status_code": 20000,
  "status_message": "Ok.",
  "tasks": [
    {
      "id": "…",
      "status_code": 20000,
      "result": [ { "keyword": "best running shoes", "items": [ /* … */ ] } ]
    }
  ]
}

Migration checklist
Swap the base URL to https://api.serplify.io.
Replace Basic auth with Authorization: Bearer <your Serplify key>.
Keep your existing request bodies and response parsing as-is.
Verify a live/advanced call end-to-end.
When ready, adopt the native /v1 API for new features like rank tracking.
Differences to know
Pricing — Serplify bills a flat $0.005 per successful SERP on one prepaid balance, and only successful fetches are charged.
Auth — bearer key, not login:password.
Scope — Serplify’s drop-in covers Google Organic SERP. Other DataForSEO APIs are not part of the drop-in.
Previous