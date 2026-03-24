import { google } from 'googleapis'

function getGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID!,
    process.env.GMAIL_CLIENT_SECRET!,
    'urn:ietf:wg:oauth:2.0:oob'
  )

  auth.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
  })

  return google.gmail({ version: 'v1', auth })
}

// Extract a first name from an email address or company name
function extractFirstName(email: string, companyName: string): string {
  // Try email prefix first (e.g., "jan.de.vries@..." → "Jan")
  const prefix = email.split('@')[0]
  const namePart = prefix.split(/[._-]/)[0]
  if (namePart && namePart.length > 1 && /^[a-z]/i.test(namePart)) {
    return namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase()
  }
  // Fall back to company name first word
  return companyName.split(' ')[0]
}

interface DraftParams {
  to: string
  companyName: string
  niche: string
  previewUrl: string
  signature?: string
}

export async function createGmailDraft(params: DraftParams): Promise<string> {
  const gmail = getGmailClient()

  const firstName = extractFirstName(params.to, params.companyName)
  const signature = params.signature ?? 'Met vriendelijke groet,\nEzra\nGraphic Vision\ngraphicvision.nl'

  const subject = `Ik heb iets voor je gebouwd, ${firstName}`

  const htmlBody = `<p>Hey ${firstName},</p>

<p>Ik ben Ezra van Graphic Vision. Ik zag je website en dacht: dit verdient beter.</p>

<p>Ik heb in een paar minuten een concept gebouwd van hoe jouw nieuwe site eruit zou kunnen zien:</p>

<p><strong><a href="${params.previewUrl}" style="color: #FF794F;">→ Bekijk het concept hier</a></strong></p>

<p>Geen verplichtingen. Ik ben benieuwd wat je ervan vindt.</p>

<p>${signature.replace(/\n/g, '<br>')}</p>`

  // RFC 2822 format
  const message = [
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody).toString('base64'),
  ].join('\r\n')

  // Base64url encode (Gmail requirement)
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const { data } = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw: encodedMessage },
    },
  })

  console.log(`[Gmail] Draft created: ${data.id} → ${params.to}`)
  return data.id!
}
