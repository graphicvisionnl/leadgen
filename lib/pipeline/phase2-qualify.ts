import { createServerSupabaseClient } from '@/lib/supabase'
import { uploadScreenshot } from '@/lib/supabase-storage'
import { qualifyWebsite } from '@/lib/claude'

// Take a screenshot of a URL using @sparticuz/chromium + puppeteer-core
// Falls back to ScreenshotOne API if Chromium fails
async function screenshotUrl(url: string): Promise<Buffer> {
  try {
    return await screenshotWithChromium(url)
  } catch (err) {
    console.warn('[Phase 2] Chromium failed, trying ScreenshotOne fallback:', err)
    return await screenshotWithFallback(url)
  }
}

async function screenshotWithChromium(url: string): Promise<Buffer> {
  // Dynamic imports — these are large packages and should only load when needed
  const chromium = await import('@sparticuz/chromium')
  const puppeteer = await import('puppeteer-core')

  const browser = await puppeteer.default.launch({
    args: chromium.default.args,
    defaultViewport: { width: 1280, height: 900 },
    executablePath: await chromium.default.executablePath(),
    headless: chromium.default.headless as boolean,
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })

    // Navigate with a 15s timeout — some sites are slow
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    })

    // Wait a bit for lazy-loaded content
    await new Promise((r) => setTimeout(r, 1000))

    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: false, // Viewport only — captures the "above the fold" impression
    })

    return Buffer.from(screenshot)
  } finally {
    await browser.close()
  }
}

async function screenshotWithFallback(url: string): Promise<Buffer> {
  const apiKey = process.env.SCREENSHOT_ONE_API_KEY
  if (!apiKey) throw new Error('No SCREENSHOT_ONE_API_KEY set and Chromium failed')

  const params = new URLSearchParams({
    access_key: apiKey,
    url,
    viewport_width: '1280',
    viewport_height: '900',
    format: 'jpg',
    image_quality: '80',
    block_ads: 'true',
    block_cookie_banners: 'true',
    delay: '1',
  })

  const res = await fetch(`https://api.screenshotone.com/take?${params}`)
  if (!res.ok) throw new Error(`ScreenshotOne failed: ${res.status} ${res.statusText}`)

  return Buffer.from(await res.arrayBuffer())
}

// Process a batch of scraped leads: screenshot → upload → Claude qualify
export async function qualifyBatch(batchSize: number = 3): Promise<{
  processed: number
  qualified: number
  disqualified: number
}> {
  const supabase = createServerSupabaseClient()

  // Fetch leads that need qualification (have a website, status = scraped, have email)
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'scraped')
    .not('website_url', 'is', null)
    .not('email', 'is', null)
    .limit(batchSize)

  if (!leads?.length) return { processed: 0, qualified: 0, disqualified: 0 }

  let qualified = 0
  let disqualified = 0

  for (const lead of leads) {
    console.log(`[Phase 2] Processing lead: ${lead.company_name} (${lead.website_url})`)

    try {
      // Add small delay between screenshots to avoid being blocked
      await new Promise((r) => setTimeout(r, 2000))

      // Take screenshot
      const screenshotBuffer = await screenshotUrl(lead.website_url!)

      // Upload to Supabase Storage
      const filename = `${lead.id}-${Date.now()}.jpg`
      const screenshotUrl2 = await uploadScreenshot(screenshotBuffer, filename, 'screenshots')

      // Send to Claude for qualification
      const base64 = screenshotBuffer.toString('base64')
      const result = await qualifyWebsite(base64, lead.company_name!, lead.niche!)

      // Update lead status
      await supabase
        .from('leads')
        .update({
          screenshot_url: screenshotUrl2,
          status: result.qualified ? 'qualified' : 'disqualified',
          qualify_reason: `Score: ${result.score}/10 — ${result.reason}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id)

      console.log(
        `[Phase 2] ${lead.company_name}: ${result.qualified ? 'QUALIFIED' : 'DISQUALIFIED'} (score ${result.score})`
      )

      result.qualified ? qualified++ : disqualified++
    } catch (err) {
      console.error(`[Phase 2] Failed for ${lead.company_name}:`, err)
      await supabase
        .from('leads')
        .update({
          status: 'error',
          qualify_reason: `Fout: ${String(err).slice(0, 200)}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id)
    }
  }

  return { processed: leads.length, qualified, disqualified }
}
