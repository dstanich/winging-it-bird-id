import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CLIENT_DIR, '..');
const OUT_DIR = path.resolve(CLIENT_DIR, 'out');
const SCREENSHOTS_DIR = path.resolve(REPO_ROOT, '.screenshots');

interface DevicePreset {
  name: string;
  width: number;
  height: number;
}

const PRESETS: Record<string, DevicePreset> = {
  desktop: { name: 'desktop', width: 1280, height: 800 },
  tablet: { name: 'tablet', width: 768, height: 1024 },
  mobile: { name: 'mobile', width: 375, height: 667 },
};

interface ScreenshotOptions {
  routes: string[];
  outputName?: string;
  sizes: DevicePreset[];
  fullPage: boolean;
  baseUrl?: string;
}

function parseArgs(): ScreenshotOptions {
  const args = process.argv.slice(2);
  const routes: string[] = [];
  let outputName: string | undefined;
  const requestedSizes: DevicePreset[] = [];
  let fullPage = false;
  let baseUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: npm run screenshot [-- [routes...]] [options]

Arguments:
  routes            Path(s) to capture, e.g. / /settings/ /2026-10-06/ (default: / and latest date)

Options:
  --all-sizes       Capture desktop (1280x800), tablet (768x1024), and mobile (375x667)
  --desktop         Capture desktop viewport only (1280x800)
  --tablet          Capture tablet viewport only (768x1024)
  --mobile          Capture mobile viewport only (375x667)
  --name <filename> Custom filename (applies when capturing a single route and size)
  --full-page       Capture the full scrollable page height
  --base-url <url>  Target a running server (default: serves client/out via in-memory Playwright routing)
  -h, --help        Show this help message
`);
      process.exit(0);
    } else if (arg === '--all-sizes') {
      requestedSizes.push(PRESETS.desktop, PRESETS.tablet, PRESETS.mobile);
    } else if (arg === '--desktop') {
      requestedSizes.push(PRESETS.desktop);
    } else if (arg === '--tablet') {
      requestedSizes.push(PRESETS.tablet);
    } else if (arg === '--mobile') {
      requestedSizes.push(PRESETS.mobile);
    } else if (arg === '--full-page') {
      fullPage = true;
    } else if (arg === '--base-url' && i + 1 < args.length) {
      baseUrl = args[++i];
    } else if (arg === '--name' && i + 1 < args.length) {
      outputName = args[++i];
    } else if (arg.startsWith('--')) {
      console.warn(`Unknown option: ${arg}`);
    } else {
      routes.push(arg);
    }
  }

  // Default to desktop if no sizes specified
  const sizes = requestedSizes.length > 0 ? requestedSizes : [PRESETS.desktop];

  // If no routes were passed, detect default routes
  if (routes.length === 0) {
    routes.push('/');
    if (fs.existsSync(OUT_DIR)) {
      // Find the first date folder (YYYY-MM-DD format) in out/
      const entries = fs.readdirSync(OUT_DIR, { withFileTypes: true });
      const dateEntry = entries.find((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name));
      if (dateEntry) {
        routes.push(`/${dateEntry.name}/`);
      }
    }
  }

  return { routes, outputName, sizes, fullPage, baseUrl };
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html';
    case '.css': return 'text/css';
    case '.js': return 'application/javascript';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.woff2': return 'font/woff2';
    case '.woff': return 'font/woff';
    case '.ttf': return 'font/ttf';
    default: return 'application/octet-stream';
  }
}

async function main() {
  const options = parseArgs();

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await launchBrowser();

  // If no baseUrl is provided, route through static client/out in memory (works completely offline & sandboxed)
  if (!options.baseUrl && !fs.existsSync(OUT_DIR)) {
    console.error('Error: client/out does not exist. Run "npm run build" first or pass --base-url http://localhost:3000');
    await browser.close();
    process.exit(1);
  }

  const baseOrigin = options.baseUrl || 'http://local-app';
  const captured: string[] = [];

  for (const size of options.sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2, // Crisp retina screenshots
    });

    const page = await context.newPage();

    if (!options.baseUrl) {
      await page.route('http://local-app/**', async (route) => {
        const url = new URL(route.request().url());
        let reqPath = decodeURI(url.pathname);
        if (reqPath.endsWith('/')) {
          reqPath += 'index.html';
        }
        let filePath = path.join(OUT_DIR, reqPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const body = fs.readFileSync(filePath);
          await route.fulfill({
            status: 200,
            contentType: getMimeType(filePath),
            body,
          });
        } else {
          await route.fulfill({ status: 404, body: 'Not found' });
        }
      });
    }

    for (const route of options.routes) {
      const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
      const targetUrl = `${baseOrigin}${normalizedRoute}`;

      let filename = options.outputName;
      if (!filename || options.sizes.length > 1) {
        const slug = normalizedRoute.replace(/^\/|\/$/g, '').replace(/[/\\?%*:|"<>]/g, '-') || 'home';
        filename = `${slug}-${size.name}.png`;
      }

      const outputPath = path.resolve(SCREENSHOTS_DIR, filename);

      console.log(`Capturing ${targetUrl} (${size.name}: ${size.width}x${size.height})...`);
      await page.goto(targetUrl);
      await page.waitForLoadState('networkidle');

      await page.screenshot({
        path: outputPath,
        fullPage: options.fullPage,
      });

      captured.push(outputPath);
      console.log(`✓ Saved: ${path.relative(REPO_ROOT, outputPath)}`);
    }

    await context.close();
  }

  await browser.close();
  console.log(`\nAll screenshots saved to ${path.relative(REPO_ROOT, SCREENSHOTS_DIR)}/`);
}

main().catch((err) => {
  console.error('Screenshot error:', err);
  process.exit(1);
});
