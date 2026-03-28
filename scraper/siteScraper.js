import puppeteer from 'puppeteer';

const DEFAULT_NAVIGATION_TIMEOUT_MS = 20000;

function normalizeUrl(url) {
  const parsedUrl = new URL(String(url).trim());

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http and https website references are supported.');
  }

  parsedUrl.hash = '';
  return parsedUrl.toString();
}

export async function scrapeSite(url, options = {}) {
  const normalizedUrl = normalizeUrl(url);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
    });
    await page.setDefaultNavigationTimeout(
      Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_NAVIGATION_TIMEOUT_MS,
    );
    await page.goto(normalizedUrl, {
      waitUntil: 'networkidle2',
    });

    const data = await page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      links: Array.from(document.querySelectorAll('a'))
        .map((anchor) => anchor.href)
        .filter(Boolean),
      buttons: Array.from(document.querySelectorAll('button'))
        .map((button) => button.innerText.trim())
        .filter(Boolean),
      forms: document.querySelectorAll('form').length,
      inputs: document.querySelectorAll('input').length,
      images: Array.from(document.images)
        .map((image) => image.src)
        .filter(Boolean),
    }));

    return {
      url: normalizedUrl,
      ...data,
    };
  } finally {
    await browser.close();
  }
}

export default {
  scrapeSite,
};
