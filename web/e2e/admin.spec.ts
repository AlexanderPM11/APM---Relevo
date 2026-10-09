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
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Revocar', exact: true }).click()
  await page.getByRole('button', { name: 'Revocar acceso' }).click()
  await expect(page.locator('.key-row').filter({ hasText: 'Portal de pruebas' }).getByText('Revocada', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Conectar una app' }).click()
  await expect(page.getByText('http://127.0.0.1:8765/v1', { exact: true })).toBeVisible()
  await expect(page.getByText('La clave “Portal de pruebas” quedó revocada.')).toBeVisible()
})

test('T061/T067/T071 parcial: navegador se conecta a FastAPI y gestiona una clave', async ({ page }) => {
  await page.goto('')
  await page.getByLabel('Correo de administrador').fill('playwright-admin@example.com')
  await page.getByLabel('Contraseña').fill('playwright-only-password')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('heading', { name: 'Tus claves, bajo control.' })).toBeVisible()

  const appName = `Aplicación real ${Date.now()}`
  await page.getByRole('button', { name: 'Nueva clave' }).click()
  await page.getByLabel('Nombre de la aplicación').fill(appName)
  await page.getByRole('button', { name: 'Crear clave' }).click()
  await expect(page.getByRole('heading', { name: 'Guárdala ahora.' })).toBeVisible()
  await expect(page.getByText('La clave de ' + appName + ' solo se muestra esta vez.')).toBeVisible()
  await page.getByRole('button', { name: 'Ya la guardé' }).click()

  await expect(page.getByText(appName)).toBeVisible()
  await page.getByRole('button', { name: 'Revocar', exact: true }).click()
  await page.getByRole('button', { name: 'Revocar acceso' }).click()
  await expect(page.locator('.key-row').filter({ hasText: appName }).getByText('Revocada', { exact: true })).toBeVisible()
})

test('login screen and key guide meet automated accessibility checks', async ({ page }) => {
  await page.route('**/console-config', (route) => route.fulfill({ json: { api_base_url: 'http://localhost:8000' } }))
  await page.goto('')
  const loginAudit = await new AxeBuilder({ page }).analyze()
  expect(loginAudit.violations).toEqual([])

  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.route('**/admin/auth/login', (route) => route.fulfill({ json: { access_token: 'e2e-admin-token' } }))
  await page.route('**/admin/api-keys', (route) => route.fulfill({ json: [] }))
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('heading', { name: 'Tus claves, bajo control.' })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Conectar una app' }).click()
  await expect(page.getByRole('heading', { name: 'Una API. Tus aplicaciones.' })).toBeVisible()
  const guideAudit = await new AxeBuilder({ page }).include('.guide-main').include('.guide-aside').analyze()
  expect(guideAudit.violations).toEqual([])
  await expect(page.getByText('http://localhost:8000/v1', { exact: true })).toBeVisible()
})

test('T076/T077/T079/T080 parcial: layout de móvil y escritorio sin desbordamiento', async ({ page }) => {
  await page.route('**/admin/auth/login', (route) => route.fulfill({ json: { access_token: 'e2e-admin-token' } }))
  await page.route('**/admin/api-keys', (route) => route.fulfill({ json: [] }))
  await page.goto('')
  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('heading', { name: 'Tus claves, bajo control.' })).toBeVisible()

  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }))
    expect(dimensions.documentWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewportWidth)
    if (width <= 650) await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('relevo.admin.session'))).toBeNull()
})

test('T084/T085 parcial: diálogo conserva el foco de teclado y pasa axe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/admin/auth/login', (route) => route.fulfill({ json: { access_token: 'e2e-admin-token' } }))
  await page.route('**/admin/api-keys', (route) => route.fulfill({ json: [] }))
  await page.goto('')
  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await page.getByRole('button', { name: 'Nueva clave' }).click()

  const dialog = page.getByRole('dialog', { name: 'Una clave por aplicación.' })
  await expect(dialog).toBeVisible()
  await page.getByLabel('Nombre de la aplicación').fill('Prueba de foco')
  expect((await new AxeBuilder({ page }).include('.modal').analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Crear clave' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Cerrar' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nueva clave' })).toBeFocused()
})
