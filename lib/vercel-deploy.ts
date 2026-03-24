// Deploy a single HTML file to Vercel via REST API
// Uses a SEPARATE Vercel account (VERCEL_API_TOKEN) dedicated to client previews

export async function deployToVercel(
  companyName: string,
  htmlContent: string
): Promise<string> {
  const token = process.env.VERCEL_API_TOKEN!
  const teamId = process.env.VERCEL_TEAM_ID

  // Sanitize company name into a valid Vercel project slug
  const slug = companyName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics (é → e)
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

  const deploymentName = `preview-${slug}-${Date.now().toString(36)}`
  const teamParam = teamId ? `?teamId=${teamId}` : ''

  // Create a static deployment with a single index.html file
  const body = {
    name: deploymentName,
    files: [
      {
        file: 'index.html',
        data: htmlContent,
        encoding: 'utf-8',
      },
    ],
    projectSettings: {
      framework: null, // Static deployment, no build step
    },
    target: 'production',
  }

  const createRes = await fetch(
    `https://api.vercel.com/v13/deployments${teamParam}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  if (!createRes.ok) {
    const err = await createRes.text()
    throw new Error(`Vercel deployment creation failed (${createRes.status}): ${err}`)
  }

  const deployment = await createRes.json()
  console.log(`[Vercel] Deployment created: ${deployment.id}`)

  // Poll until ready (static deploys usually take 10-30s)
  return await waitForDeployment(deployment.id, token, teamId)
}

async function waitForDeployment(
  deploymentId: string,
  token: string,
  teamId?: string
): Promise<string> {
  const teamParam = teamId ? `?teamId=${teamId}` : ''
  const maxAttempts = 20 // 20 × 3s = 60s max wait

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000))

    const res = await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentId}${teamParam}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )

    if (!res.ok) continue

    const data = await res.json()

    if (data.readyState === 'READY') {
      const url = `https://${data.url}`
      console.log(`[Vercel] Deployment ready: ${url}`)
      return url
    }

    if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
      throw new Error(`Vercel deployment failed with state: ${data.readyState}`)
    }
  }

  throw new Error('Vercel deployment timed out after 60s')
}
