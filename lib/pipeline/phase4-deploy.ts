import { createServerSupabaseClient } from '@/lib/supabase'
import { downloadHtml, uploadScreenshot } from '@/lib/supabase-storage'
import { deployToVercel } from '@/lib/vercel-deploy'

// Take a screenshot of the deployed preview (non-critical — won't fail the pipeline if it errors)
async function screenshotDeployedPreview(url: string): Promise<Buffer | null> {
  try {
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
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })
      await new Promise((r) => setTimeout(r, 1500))
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false })
      return Buffer.from(screenshot)
    } finally {
      await browser.close()
    }
  } catch (err) {
    console.warn('[Phase 4] Preview screenshot mislukt (niet kritiek):', err)
    return null
  }
}

export async function deployBatch(batchSize: number = 2): Promise<{
  processed: number
  deployed: number
}> {
  const supabase = createServerSupabaseClient()

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'redesigned')
    .not('email', 'is', null)
    .limit(batchSize)

  if (!leads?.length) return { processed: 0, deployed: 0 }

  let deployed = 0

  for (const lead of leads) {
    console.log(`[Phase 4] Preview deployen voor: ${lead.company_name}`)

    try {
      // 1. Haal HTML op uit Supabase Storage
      const html = await downloadHtml(`${lead.id}-preview.html`)

      // 2. Deploy naar Vercel (apart preview account)
      const previewUrl = await deployToVercel(lead.company_name!, html)

      // 3. Maak screenshot van de preview (optioneel)
      let previewScreenshotUrl: string | null = null
      const screenshotBuffer = await screenshotDeployedPreview(previewUrl)
      if (screenshotBuffer) {
        previewScreenshotUrl = await uploadScreenshot(
          screenshotBuffer,
          `${lead.id}-preview-screenshot.jpg`,
          'previews'
        )
      }

      // 4. Update lead — status 'deployed', klaar om mail te versturen vanuit dashboard
      await supabase
        .from('leads')
        .update({
          status: 'deployed',
          preview_url: previewUrl,
          preview_screenshot_url: previewScreenshotUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id)

      console.log(`[Phase 4] Klaar: ${lead.company_name} → ${previewUrl}`)
      deployed++
    } catch (err) {
      console.error(`[Phase 4] Mislukt voor ${lead.company_name}:`, err)
      await supabase
        .from('leads')
        .update({
          status: 'error',
          qualify_reason: `Deploy fout: ${String(err).slice(0, 200)}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id)
    }
  }

  return { processed: leads.length, deployed }
}
