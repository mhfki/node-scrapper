# Scraper API

A small Express-based API that returns the raw JSON from Naver Shopping’s paged-composite-cards endpoint.
Designed for stability under load using Redis caching, API-key/IP rotation (via ScraperAPI), fingerprint rotation, global throttling, and retry with jitter.

# 1. Setup
Prerequisites

- Docker & Docker Compose
- A ScraperAPI account; you’ll need one or more API keys.

Create .env in the project root (example values below):
```
SCRAPER_API_KEYS=b1e74759fd7555a995ad74df5f00024a,08e9e01159df3a40b9ef8430c613cbdc
REDIS_URL=redis://redis:6379
CACHE_TTL_SEC=60
THROTTLE_MIN_MS=150
RESERVOIR_PER_MIN=360
COUNTRY_CODE=kr
NGROK_AUTHTOKEN=31rO6VmmsH5o97UYqPcnOis6zlY_7KzwTVyxQJC5e6x7nCrzY
NGROK_DOMAIN=pheasant-internal-herring.ngrok-free.app
```

# 2. Build and run the Node app and Redis together:
```
docker compose up --build
```

# 3. How the Scraper Works (Evasion & Stability)

This project uses the following strategies inside src/controller/ScraperController.js:

- Raw JSON passthrough

The controller fetches the target URL (Naver paged-composite-cards) via ScraperAPI and returns res.data unchanged to the client.

- IP rotation (via ScraperAPI)

SCRAPER_API_KEYS can contain multiple keys; requests rotate keys:
```
const API_KEYS = SCRAPER_API_KEYS.split(',').map(s => s.trim()).filter(Boolean);
let rr = 0;
const getApiKey = () => API_KEYS[(rr++) % API_KEYS.length];
```

Requests are routed through ScraperAPI with country_code=${COUNTRY_CODE} to ensure Korea IPs:
```
http://api.scraperapi.com?api_key=${encodeURIComponent(apiKey)}&render=false&country_code=${encodeURIComponent(COUNTRY_CODE)}&url=${encodeURIComponent(targetUrl)}
```

- Fingerprint rotation

A small pool of User-Agents; one is picked randomly per request:
```
const getUA = () => userAgents[Math.floor(Math.random() * userAgents.length)];
```

- Request throttling (global) + token bucket

Using Bottleneck to shape outbound traffic and avoid 429s:
```
const limiter = new Bottleneck({
  minTime: +THROTTLE_MIN_MS,
  reservoir: +RESERVOIR_PER_MIN,
  reservoirRefreshAmount: +RESERVOIR_PER_MIN,
  reservoirRefreshInterval: 60 * 1000,
});
```

- Redis caching (cut load & latency)

Cache-first strategy with Redis to deduplicate repeated queries:
```
const cacheKey = keyCache(sha1(apiUrl));
const hit = await redis.get(cacheKey);
if (hit) return JSON.parse(hit);
// fetch → set EX TTL
await redis.set(cacheKey, JSON.stringify(data), 'EX', TTL);
```

# Example usage of API

You can test the API using **Postman**.

# 1. Start the server
Make sure API server is running:
```
docker-compose up --build
```

# 2. Open Postman.

- Create a new GET request.

- Paste the API endpoint, for example:
```
http://localhost:3000/api/scraper/getData?url=https://search.shopping.naver.com/ns/v1/search/paged-composite-cards?cursor=1%26pageSize=50%26query=10006990%26searchMethod=displayCategory.basic%26isCatalogDiversifyOff=true%26hiddenNonProductCard=false%26hasMoreAd=false%26onlySecondhand=false%26onlyRental=false%26onlyOversea=false
```
