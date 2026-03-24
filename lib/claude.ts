import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { QualificationResult } from '@/types'

function loadSkill(filename: string): string {
  try {
    return readFileSync(join(process.cwd(), 'lib/skills', filename), 'utf-8')
  } catch {
    return ''
  }
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Phase 2: Visual qualification
// Returns whether the site needs a redesign + reason + score
export async function qualifyWebsite(
  screenshotBase64: string,
  companyName: string,
  niche: string
): Promise<QualificationResult> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: `Je bent een expert webdesigner die beoordeelt of een lokaal bedrijf een nieuwe website nodig heeft.

Bedrijf: ${companyName} (${niche})

Geef YES als de site minimaal één van deze signalen toont:
- Verouderd visueel design (tabellen, clip art, beveled buttons, tiled backgrounds)
- Pre-2015 uitstraling (text drop shadows, gradients overal, marquee text)
- Geen mobiele responsiviteit (fixed-width, horizontale scrollbar)
- Slechte typografie (één font, geen contrast, generieke system fonts)
- Geen duidelijke hero/CTA (wall of text, geen button above the fold)
- Amateuristieke foto's of stockfoto's van lage kwaliteit

De bar is HOOG. De vraag is niet "is de site kapot" maar "ziet dit eruit als een premium custom design?".
De meeste lokale bedrijfssites scoren YES.

Antwoord ALLEEN in dit exacte JSON-formaat (geen markdown, geen uitleg):
{"qualified":true,"score":8,"reason":"Verouderd design uit ~2014 met slechte mobile layout en geen duidelijke CTA"}`,
          },
        ],
      },
    ],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text.trim() : ''

  // Strip markdown code blocks if Claude wraps the JSON
  const clean = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()

  try {
    return JSON.parse(clean) as QualificationResult
  } catch {
    // Fallback: if parsing fails, default to qualified (err on the side of inclusion)
    console.error('[Claude qualify] JSON parse failed:', text)
    return { qualified: true, reason: 'Parse fout — handmatig controleren', score: 5 }
  }
}

// Phase 3: Full HTML redesign generation using taste-skill + redesign-skill
export async function generateRedesignHTML(lead: {
  company_name: string
  niche: string
  city: string
  website_url: string
  google_rating: number | null
  review_count: number | null
}): Promise<string> {
  const tasteSkill = loadSkill('taste-skill.md')
  const redesignSkill = loadSkill('redesign-skill.md')

  const ratingLine = lead.google_rating
    ? `- Google rating: ${lead.google_rating} sterren (${lead.review_count ?? 0} reviews) — vermeld dit prominent`
    : ''

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8096,
    system: `You are a senior UI/UX engineer at a premium design agency. You generate single-file HTML websites that look hand-crafted, not AI-generated.

${tasteSkill}

${redesignSkill}`,
    messages: [
      {
        role: 'user',
        content: `Genereer een premium single-file website redesign voor:

Bedrijfsnaam: ${lead.company_name}
Branche: ${lead.niche}
Stad: ${lead.city}
Huidige site: ${lead.website_url}
${ratingLine}

Technische eisen:
- Volledig zelfstandig HTML bestand — alle CSS inline in <style>, minimale vanilla JS inline in <script>
- Geen externe CSS frameworks (geen Bootstrap, Tailwind CDN). Alleen Google Fonts CDN toegestaan
- Mobiel-responsief met CSS Grid/Flexbox
- Subtiele CSS @keyframes animaties voor entry effects
- Floating badge rechtsonder: klein, subtiel — "Concept: Graphic Vision" met link naar graphicvision.nl

Secties (in volgorde):
1. Hero — asymmetrisch, grote headline, sterke CTA knop ("Bel ons nu" of "Vraag offerte aan")
2. Diensten — 3-4 specifieke diensten voor deze branche, geen generieke omschrijvingen
3. Over ons — kort, lokaal verankerd (stad vermelden)
4. Contact — telefoonnummer placeholder, adres placeholder, simpel formulier

Return ALLEEN de volledige HTML startend met <!DOCTYPE html>. Geen markdown, geen uitleg, geen code blocks.`,
      },
    ],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : ''

  // Ensure we get clean HTML
  const htmlStart = text.indexOf('<!DOCTYPE html>')
  if (htmlStart === -1) {
    throw new Error('Claude returned no valid HTML (missing <!DOCTYPE html>)')
  }

  return text.substring(htmlStart)
}
