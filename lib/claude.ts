import Anthropic from '@anthropic-ai/sdk'
import { QualificationResult } from '@/types'

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

// Phase 3: Full HTML redesign generation
export async function generateRedesignHTML(lead: {
  company_name: string
  niche: string
  city: string
  website_url: string
  google_rating: number | null
  review_count: number | null
}): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8096,
    messages: [
      {
        role: 'user',
        content: `Genereer een premium single-file website redesign voor ${lead.company_name}, een ${lead.niche} bedrijf in ${lead.city}.

Eisen:
- Volledig zelfstandig HTML bestand (alle CSS en JS inline, geen externe dependencies behalve Google Fonts CDN)
- Modern 2024 design met schone typografie, veel witruimte
- Hero sectie met een subtiele gradient waarbij #FF794F gebruikt wordt als accent kleur
- Secties: Hero (naam + tagline + CTA knop), Diensten (3-4 diensten), Over ons, Contact
- Mobiel-responsief met CSS Grid/Flexbox
- Subtiele CSS animaties (geen zware JS frameworks)
- Professioneel kleurenpalet passend bij de ${lead.niche} branche
- Floating badge rechtsboven: "Concept door Graphic Vision — graphicvision.nl"
- Font: Inter van Google Fonts${lead.google_rating ? `\n- Vermelding van de Google rating: ${lead.google_rating} sterren (${lead.review_count ?? 0} reviews)` : ''}

Gebruik realistische placeholder content gebaseerd op het bedrijfstype.
Return ALLEEN de volledige HTML, startend met <!DOCTYPE html>, geen markdown, geen uitleg.`,
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
