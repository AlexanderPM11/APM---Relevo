import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

type Key = {
  id: number
  name: string
  prefix: string
  owner: string | null
  is_active: boolean
  requests_per_minute: number
}

test('login, create one-time key, list and revoke it', async ({ page }) => {
  let keys: Key[] = []
  const secret = 'rlv_4ad28f10_unique_secret_for_e2e'

  await page.route('**/admin/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/admin/auth/login' && route.request().method() === 'POST') {
      await route.fulfill({ json: { access_token: 'e2e-admin-token', token_type: 'bearer' } })
      return
    }
    if (pathname === '/admin/api-keys' && route.request().method() === 'GET') {
      await route.fulfill({ json: keys })
      return
    }
    if (pathname === '/admin/api-keys' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string; owner: string; requests_per_minute: number }
      keys = [{ id: 7, name: body.name, owner: body.owner, prefix: '4ad28f10', is_active: true, requests_per_minute: body.requests_per_minute }]
      await route.fulfill({ status: 201, json: { id: 7, name: body.name, prefix: '4ad28f10', api_key: secret } })
      return
    }
    if (pathname === '/admin/api-keys/7' && route.request().method() === 'DELETE') {
      keys = keys.map((key) => ({ ...key, is_active: false }))
      await route.fulfill({ status: 204, body: '' })
      return
    }
    await route.fulfill({ status: 404, json: { detail: 'Unexpected test request' } })
  })

  await page.goto('')
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible()
  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()

  await expect(page.getByRole('heading', { name: 'Tus claves, bajo control.' })).toBeVisible()
  await page.getByRole('button', { name: 'Nueva clave' }).click()
  await page.getByLabel('Nombre de la aplicación').fill('Portal de pruebas')
  await page.getByLabel('Propietario').fill('Equipo web')
  await page.getByRole('button', { name: 'Crear clave' }).click()
  await expect(page.getByRole('heading', { name: 'Guárdala ahora.' })).toBeVisible()
  await expect(page.getByText('La clave de Portal de pruebas solo se muestra esta vez.')).toBeVisible()
  await page.getByRole('button', { name: 'Mostrar' }).click()
  await expect(page.getByText(secret)).toBeVisible()
  await page.getByRole('button', { name: 'Ocultar' }).click()
  await page.getByRole('button', { name: 'Ya la guardé' }).click()

  await expect(page.getByText('Portal de pruebas')).toBeVisible()
  await expect(page.getByText('rlv_4ad28f10••••••••')).toBeVisible()
  await expect(page.getByText(secret)).toHaveCount(0)
  await page.getByRole('button', { name: 'Revocar', exact: true }).click()
  await page.getByRole('button', { name: 'Revocar acceso' }).click()
  await expect(page.getByText('Revocada', { exact: true })).toBeVisible()
  await expect(page.getByText('La clave “Portal de pruebas” quedó revocada.')).toBeVisible()
})

test('login screen and key guide meet automated accessibility checks', async ({ page }) => {
  await page.goto('')
  const loginAudit = await new AxeBuilder({ page }).analyze()
  expect(loginAudit.violations).toEqual([])

  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.route('**/admin/auth/login', (route) => route.fulfill({ json: { access_token: 'e2e-admin-token' } }))
  await page.route('**/admin/api-keys', (route) => route.fulfill({ json: [] }))
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('heading', { name: 'Tus claves, bajo control.' })).toBeVisible()
  await page.getByRole('button', { name: 'Conectar una app' }).click()
  await expect(page.getByRole('heading', { name: 'Una API. Tus aplicaciones.' })).toBeVisible()
  const guideAudit = await new AxeBuilder({ page }).analyze()
  expect(guideAudit.violations).toEqual([])
  await expect(page.getByText('http://localhost:8000/v1', { exact: true })).toBeVisible()
})

test('mobile layout has no horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('')
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
})
