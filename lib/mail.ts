import nodemailer from 'nodemailer'

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,       // bijv. smtp.hostinger.com
    port: parseInt(process.env.SMTP_PORT ?? '465'),
    secure: process.env.SMTP_PORT === '465', // true voor 465 (SSL), false voor 587 (STARTTLS)
    auth: {
      user: process.env.SMTP_USER!,     // bijv. ezra@graphicvision.nl
      pass: process.env.SMTP_PASS!,
    },
  })
}

// Extract a first name from an email address or company name
function extractFirstName(email: string, companyName: string): string {
  const prefix = email.split('@')[0]
  const namePart = prefix.split(/[._-]/)[0]
  if (namePart && namePart.length > 1 && /^[a-z]/i.test(namePart)) {
    return namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase()
  }
  return companyName.split(' ')[0]
}

interface SendMailParams {
  to: string
  companyName: string
  niche: string
  previewUrl: string
  signature?: string
}

export async function sendPreviewMail(params: SendMailParams): Promise<void> {
  const transport = createTransport()
  const firstName = extractFirstName(params.to, params.companyName)
  const signature = params.signature ?? 'Met vriendelijke groet,\nEzra\nGraphic Vision\ngraphicvision.nl'

  const subject = `Ik heb iets voor je gebouwd, ${firstName}`

  const html = `<p>Hey ${firstName},</p>

<p>Ik ben Ezra van Graphic Vision. Ik zag je website en dacht: dit verdient beter.</p>

<p>Ik heb in een paar minuten een concept gebouwd van hoe jouw nieuwe site eruit zou kunnen zien:</p>

<p><strong><a href="${params.previewUrl}" style="color: #FF794F;">→ Bekijk het concept hier</a></strong></p>

<p>Geen verplichtingen. Ik ben benieuwd wat je ervan vindt.</p>

<p>${signature.replace(/\n/g, '<br>')}</p>`

  await transport.sendMail({
    from: `Ezra — Graphic Vision <${process.env.SMTP_USER}>`,
    to: params.to,
    subject,
    html,
  })

  console.log(`[Mail] Verzonden naar ${params.to}`)
}
