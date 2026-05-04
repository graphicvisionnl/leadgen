const FAKE_EMAIL_LOCALS = new Set([
  'test',
  'tester',
  'testing',
  'joedoe',
  'joe.doe',
  'johndoe',
  'john.doe',
  'janedoe',
  'jane.doe',
  'dummy',
  'fake',
  'demo',
  'example',
  'mail',
  'email',
  'name',
  'naam',
  'voornaam',
  'achternaam',
  'firstname',
  'lastname',
])

const FAKE_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.nl',
  'test.com',
  'test.nl',
  'fake.com',
  'dummy.com',
])

export function getFakeEmailReason(email: string | null | undefined): string | null {
  if (!email) return null
  const normalized = email.trim().toLowerCase()
  const match = normalized.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/)
  if (!match) return 'Ongeldig e-mailadres'

  const local = match[1].replace(/\+.*$/, '')
  const domain = match[2].replace(/^www\./, '')

  if (FAKE_EMAIL_DOMAINS.has(domain)) return `Fake/test domein: ${domain}`
  if (FAKE_EMAIL_LOCALS.has(local)) return `Fake/test mailbox: ${local}`
  if (/^(test|fake|dummy|demo)[._-]?\d*$/i.test(local)) return `Fake/test mailbox: ${local}`
  if (/^(joe|john|jane)[._-]?doe\d*$/i.test(local)) return `Placeholder mailbox: ${local}`
  if (local.includes('whatever')) return `Placeholder mailbox: ${local}`

  return null
}

export function isFakeEmail(email: string | null | undefined): boolean {
  return getFakeEmailReason(email) !== null
}
