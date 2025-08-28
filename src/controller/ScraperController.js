const axios = require('axios');
const Redis = require('ioredis');
const crypto = require('crypto');
const Bottleneck = require('bottleneck');
const { Ok, BadRequest, InternalServerErr } = require('../helper/ResponseUtil');

const {
  SCRAPER_API_KEYS,
  REDIS_URL,
  CACHE_TTL_SEC,
  THROTTLE_MIN_MS,
  RESERVOIR_PER_MIN,
  COUNTRY_CODE,
} = process.env;

const TTL = +CACHE_TTL_SEC;

// Rotate API keys
const API_KEYS = SCRAPER_API_KEYS.split(',').map(s => s.trim()).filter(Boolean);
let rr = 0;
const getApiKey = () => API_KEYS[(rr++) % API_KEYS.length];

// Redis
const redis = new Redis(REDIS_URL);
redis.on('error', e => console.error('Redis error:', e?.message || e));

// Fingerprints
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:118.0) Gecko/20100101 Firefox/118.0',
];
const getUA = () => userAgents[Math.floor(Math.random() * userAgents.length)];

/** ===== Utils ===== */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

const buildScraperUrl = (targetUrl, apiKey) =>
  `http://api.scraperapi.com?api_key=${encodeURIComponent(apiKey)}&render=false&country_code=${encodeURIComponent(COUNTRY_CODE)}&url=${encodeURIComponent(targetUrl)}`;

const keyCache = (h) => `sc:cache:${h}`;

function makeCacheKey(targetUrl) {
  try {
    const u = new URL(targetUrl);
    u.hash = '';                       // ignore fragment
    u.searchParams.sort();             // canonicalize query order
    return keyCache(sha1(`${COUNTRY_CODE}|${u.toString()}`));
  } catch {
    return keyCache(sha1(`${COUNTRY_CODE}|${targetUrl}`));
  }
}

/** ===== Throttler (global) ===== */
const limiter = new Bottleneck({
  minTime: +THROTTLE_MIN_MS,               // minimum spacing between jobs
  reservoir: +RESERVOIR_PER_MIN,           // request per minute
  reservoirRefreshAmount: +RESERVOIR_PER_MIN,
  reservoirRefreshInterval: 60 * 1000,     // refresh every minute
});

/** ===== Fetch + retry (429/5xx/timeout) ===== */
async function fetchWithRetry(apiUrl, MAX_RETRIES = 1, BASE_DELAY = 600) {
  let lastErr;
  for (let a = 0; a <= MAX_RETRIES; a++) {
    try {
      return (await axios.get(apiUrl, { headers: { 'User-Agent': getUA() } })).data;
    } catch (err) {
      const s = err?.response?.status;

      const retryable =
        s === 429 || (s >= 500 && s < 600) ||
        ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED'].includes(err.code);
      if (!retryable || a === MAX_RETRIES) { lastErr = err; break; }

      // fixed delay + small jitter (0-200ms)
      const delayMs = BASE_DELAY + Math.floor(Math.random() * 200);
      console.warn(`Retry ${a + 1}/${MAX_RETRIES} in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

async function getWithCache(targetUrl) {
  const apiKey = getApiKey();
  const apiUrl = buildScraperUrl(targetUrl, apiKey);
  const cacheKey = makeCacheKey(targetUrl);

  // 1) Cache hit
  const hit = await redis.get(cacheKey);
  if (hit) { try { return JSON.parse(hit); } catch { return hit; } }

  // 2) Jitter before upstream
  await sleep(Math.floor(Math.random() * 120));       // 0–120 ms

  // 3) Throttle + fetch upstream
  const data = await limiter.schedule(() => fetchWithRetry(apiUrl));

  // 4) Set Cache
  await redis.set(cacheKey, typeof data === 'string' ? data : JSON.stringify(data), 'EX', TTL);
  return data;
}

class ScraperController {
  async getScrapedData(req, res) {
    try {
      const { url } = req.query;
      if (!url) return BadRequest(res, 'Target URL is required');
      if (!API_KEYS.length) return InternalServerErr(res, 'Missing SCRAPER_API_KEYS');

      const data = await getWithCache(url);
      return Ok(res, data);
    } catch (err) {
      console.error('Scraper failed:', err?.message || err);
      return InternalServerErr(res, 'Failed to fetch data from ScraperAPI');
    }
  }
}

module.exports = ScraperController;
