import nodemailer from 'nodemailer'

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? '465'),
    secure: process.env.SMTP_PORT !== '587',
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  })
}

function extractFirstName(email: string, companyName: string): string {
  const prefix = email.split('@')[0]
  const namePart = prefix.split(/[._-]/)[0]
  if (namePart && namePart.length > 1 && /^[a-z]/i.test(namePart)) {
    return namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase()
  }
  return companyName.split(' ')[0]
}

interface DraftParams {
  to: string
  companyName: string
  previewUrl: string
  signature?: string
}

export function buildEmailDraft(params: DraftParams): { subject: string; plainText: string } {
  const firstName = extractFirstName(params.to, params.companyName)
  const signature = params.signature ?? 'Met vriendelijke groet,\nEzra\nGraphic Vision\ngraphicvision.nl'

  const subject = `Ik heb iets voor je gebouwd, ${firstName}`
  const plainText = [
    `Hey ${firstName},`,
    '',
    `Ik ben Ezra van Graphic Vision. Ik zag je website en dacht: dit verdient beter.`,
    '',
    `Ik heb in een paar minuten een concept gebouwd van hoe jouw nieuwe site eruit zou kunnen zien:`,
    '',
    `→ ${params.previewUrl}`,
    '',
    `Geen verplichtingen. Ik ben benieuwd wat je ervan vindt.`,
    '',
    signature,
  ].join('\n')

  return { subject, plainText }
}

function plainTextToHtml(text: string, previewUrl: string): string {
  const lines = text.split('\n')
  const htmlLines = lines.map(line => {
    // Make the preview URL a clickable styled link
    if (line.includes(previewUrl)) {
      return line.replace(
        previewUrl,
        `<a href="${previewUrl}" style="color: #FF794F; font-weight: bold;">${previewUrl}</a>`
      )
    }
    return line
  })
  // Wrap paragraphs (double newlines become </p><p>)
  return '<p>' + htmlLines.join('<br>').replace(/<br><br>/g, '</p><p>') + '</p>'
}

interface SendMailParams {
  to: string
  companyName: string
  previewUrl: string
  signature?: string
  subjectOverride?: string
  bodyOverride?: string
}

export async function sendPreviewMail(params: SendMailParams): Promise<void> {
  const transport = createTransport()

  const draft = buildEmailDraft({
    to: params.to,
    companyName: params.companyName,
    previewUrl: params.previewUrl,
    signature: params.signature,
  })

  const subject = params.subjectOverride ?? draft.subject
  const plainText = params.bodyOverride ?? draft.plainText
  const html = plainTextToHtml(plainText, params.previewUrl)

  await transport.sendMail({
    from: `Ezra — Graphic Vision <${process.env.SMTP_USER}>`,
    to: params.to,
    subject,
    html,
    text: plainText,
  })

  console.log(`[Mail] Verzonden naar ${params.to}`)
}
