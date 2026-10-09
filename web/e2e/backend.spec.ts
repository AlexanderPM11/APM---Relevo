import { expect, request as playwrightRequest, test } from '@playwright/test'

const apiOrigin = (process.env.RELEVO_E2E_API_URL ?? 'http://127.0.0.1:8765').replace(/\/$/, '')
const adminEmail = process.env.RELEVO_E2E_ADMIN_EMAIL
const adminPassword = process.env.RELEVO_E2E_ADMIN_PASSWORD

test.describe('API real de Relevo', () => {
  test('T001 T005 T011 T017 T018 T020 T021: autentica, crea una clave, comprueba el acceso y la revoca', async () => {
    const client = await playwrightRequest.newContext({ baseURL: apiOrigin })
    let token: string | undefined
    let keyId: number | undefined
    let apiKey: string | undefined
    try {
      const health = await client.get('/health')
      expect(health.ok()).toBeTruthy()
      expect(await health.json()).toEqual({ status: 'ok' })

      const login = await client.post('/admin/auth/login', {
        data: { email: adminEmail ?? 'playwright-admin@example.com', password: adminPassword ?? 'playwright-only-password' },
      })
      expect(login.status()).toBe(200)
      token = (await login.json()).access_token as string
      const headers = { Authorization: `Bearer ${token}` }

      const providers = await client.get('/admin/providers', { headers })
      expect(providers.status()).toBe(200)
      const providerPayload = await providers.json() as Array<Record<string, unknown>>
      for (const provider of providerPayload) {
        expect(provider).not.toHaveProperty('api_key')
        expect(provider).not.toHaveProperty('secret')
        expect(provider).not.toHaveProperty('token')
        expect(provider).not.toHaveProperty('key_hash')
      }

      const create = await client.post('/admin/api-keys', {
        headers,
        data: { name: `Playwright ${Date.now()}`, owner: 'Suite aislada', requests_per_minute: 25 },
      })
      expect(create.status()).toBe(201)
      const created = await create.json() as { id: number; api_key: string; prefix: string }
      keyId = created.id
      apiKey = created.api_key
      expect(apiKey).toMatch(/^rlv_[a-f0-9]+_[A-Za-z0-9_-]+$/)

      const listing = await client.get('/admin/api-keys', { headers })
      expect(listing.status()).toBe(200)
      const listingText = await listing.text()
      expect(listingText).toContain(created.prefix)
      expect(listingText).not.toContain(apiKey)

      const models = await client.get('/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      expect(models.status()).toBe(200)
      expect((await models.json()).object).toBe('list')

      const revoke = await client.delete(`/admin/api-keys/${keyId}`, { headers })
      expect(revoke.status()).toBe(204)
      const deniedAfterRevoke = await client.get('/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      expect(deniedAfterRevoke.status()).toBe(401)
    } finally {
      if (token && keyId) {
        await client.delete(`/admin/api-keys/${keyId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined)
      }
      await client.dispose()
    }
  })

  test('T006 T016: rechaza una credencial incorrecta y límites fuera de rango', async () => {
    const client = await playwrightRequest.newContext({ baseURL: apiOrigin })
    try {
      const denied = await client.post('/admin/auth/login', {
        data: { email: adminEmail ?? 'playwright-admin@example.com', password: `${adminPassword ?? 'playwright-only-password'}-incorrecta` },
      })
      expect(denied.status()).toBe(401)

      const login = await client.post('/admin/auth/login', {
        data: { email: adminEmail ?? 'playwright-admin@example.com', password: adminPassword ?? 'playwright-only-password' },
      })
      expect(login.status()).toBe(200)
      const token = (await login.json()).access_token as string
      const invalidKey = await client.post('/admin/api-keys', {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Fuera de rango', requests_per_minute: 10001 },
      })
      expect(invalidKey.status()).toBe(422)
    } finally {
      await client.dispose()
    }
  })

  test('T041 T045 T059: usa proveedor simulado, aplica cooldown y hace fallback', async () => {
    const client = await playwrightRequest.newContext({ baseURL: apiOrigin })
    let token: string | undefined
    let keyId: number | undefined
    try {
      const login = await client.post('/admin/auth/login', {
        data: { email: adminEmail ?? 'playwright-admin@example.com', password: adminPassword ?? 'playwright-only-password' },
      })
      expect(login.status()).toBe(200)
      token = (await login.json()).access_token as string
      const adminHeaders = { Authorization: `Bearer ${token}` }
      const primary = await client.post('/admin/providers/pw-primary-provider', {
        headers: adminHeaders,
        data: { name: 'Playwright primary', base_url: 'http://127.0.0.1:8766/v1', env_key_name: 'GROQ_API_KEY' },
      })
      expect(primary.ok()).toBeTruthy()
      const secondary = await client.post('/admin/providers/pw-secondary-provider', {
        headers: adminHeaders,
        data: { name: 'Playwright secondary', base_url: 'http://127.0.0.1:8766/v1', env_key_name: 'GROQ_API_KEY' },
      })
      expect(secondary.ok()).toBeTruthy()
      const primaryProviderId = (await primary.json()).id as number
      const secondaryProviderId = (await secondary.json()).id as number
      let primaryModelId: number | undefined
      for (const [provider_id, name, alias, tier] of [
        [primaryProviderId, 'pw-primary', 'pw-primary-alias', 0],
        [secondaryProviderId, 'pw-secondary', 'pw-secondary-alias', 1],
      ] as const) {
        const model = await client.post('/admin/models', {
          headers: adminHeaders,
          data: { provider_id, name, alias, tier, priority: 1, context_max: 8192, capabilities: ['text'] },
        })
        expect(model.status()).toBe(201)
        if (name === 'pw-primary') primaryModelId = (await model.json()).id as number
      }
      const createdKey = await client.post('/admin/api-keys', {
        headers: adminHeaders,
        data: { name: 'Chat fallback Playwright', requests_per_minute: 25 },
      })
      expect(createdKey.status()).toBe(201)
      const key = await createdKey.json() as { id: number; api_key: string }
      keyId = key.id
      const completion = await client.post('/v1/chat/completions', {
        headers: { Authorization: `Bearer ${key.api_key}` },
        data: { model: 'auto', messages: [{ role: 'user', content: 'Prueba de fallback' }] },
      })
      expect(completion.status()).toBe(200)
      expect(completion.headers()['x-relevo-provider']).toBe('pw-secondary-provider')
      expect(completion.headers()['x-relevo-model']).toBe('pw-secondary')
      expect(completion.headers()['x-relevo-attempts']).toBe('2')
      expect((await completion.json()).choices[0].message.content).toBe('respuesta simulada')

      expect(primaryModelId).toBeDefined()
      const rateLimitedPrimary = await client.patch(`/admin/models/${primaryModelId}`, {
        headers: adminHeaders,
        data: {
          provider_id: primaryProviderId,
          name: 'pw-primary-429',
          alias: 'pw-primary-429-alias',
          tier: 0,
          priority: 1,
          context_max: 8192,
          capabilities: ['text'],
        },
      })
      expect(rateLimitedPrimary.ok()).toBeTruthy()
      const rateLimitedCompletion = await client.post('/v1/chat/completions', {
        headers: { Authorization: `Bearer ${key.api_key}` },
        data: { model: 'auto', messages: [{ role: 'user', content: 'Prueba de rate limit' }] },
      })
      expect(rateLimitedCompletion.status()).toBe(200)
      expect(rateLimitedCompletion.headers()['x-relevo-provider']).toBe('pw-secondary-provider')
      expect(rateLimitedCompletion.headers()['x-relevo-attempts']).toBe('2')
      const catalog = await client.get('/v1/models', {
        headers: { Authorization: `Bearer ${key.api_key}` },
      })
      expect((await catalog.json()).data.map((model: { id: string }) => model.id)).not.toContain('pw-primary-429-alias')
      const stats = await client.get('/admin/stats', { headers: adminHeaders })
      expect(stats.status()).toBe(200)
      const statsBody = await stats.json()
      expect(statsBody.fallbacks).toBeGreaterThanOrEqual(2)
    } finally {
      if (token && keyId) {
        await client.delete(`/admin/api-keys/${keyId}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined)
      }
      await client.dispose()
    }
  })
})
