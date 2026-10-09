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

test('summary, service status, theme preference and command navigation are usable', async ({ page }) => {
  await page.route('**/ready', (route) => route.fulfill({ json: { status: 'ok', database: 'ok', models: 'available' } }))
  await page.route('**/admin/auth/login', (route) => route.fulfill({ json: { access_token: 'e2e-admin-token' } }))
  await page.route('**/admin/api-keys', (route) => route.fulfill({ json: [{ id: 1, name: 'Portal', prefix: 'a1b2c3d4', owner: 'Equipo Web', is_active: true, requests_per_minute: 60 }] }))
  await page.route('**/admin/playground/catalog', (route) => route.fulfill({ json: { api_keys: [], models: [] } }))
  await page.goto('')
  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
  await expect(page.getByText('Claves registradas')).toBeVisible()
  await expect(page.getByText('Equipo Web')).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await page.getByRole('button', { name: 'Cambiar a tema oscuro' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('relevo.console.theme'))).toBe('dark')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Servicio listo' }).click()
  await expect(page.getByText('Base de datos', { exact: true })).toBeVisible()
  await expect(page.getByText('Disponibles', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Acciones rápidas' })
  await expect(palette).toBeVisible()
  await page.getByRole('option', { name: 'Ir a Playground Navegación' }).click()
  await expect(page.getByRole('heading', { name: 'Chat API' })).toBeVisible()
})

test('invalid credentials do not enumerate accounts and an expired JWT returns to login', async ({ page }) => {
  await page.route('**/admin/auth/login', (route) => route.fulfill({ status: 401, json: { detail: 'Invalid email or password' } }))
  await page.goto('')
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible()
  await page.getByLabel('Correo de administrador').fill('not-a-real-account@example.com')
  await page.getByLabel('Contraseña').fill('wrong-password')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('alert')).toHaveText('El correo o la contraseña no son válidos.')
  await expect(page.getByRole('alert')).not.toContainText('not-a-real-account@example.com')

  await page.unroute('**/admin/auth/login')
  await page.route('**/admin/auth/login', (route) => route.fulfill({ json: { access_token: 'expired-admin-token' } }))
  await page.route('**/admin/api-keys', (route) => route.fulfill({ status: 401, json: { detail: 'Invalid or expired administrator token' } }))
  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Tu sesión expiró')
  expect(await page.evaluate(() => sessionStorage.getItem('relevo.admin.session'))).toBeNull()
})

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
  await page.getByRole('button', { name: 'Claves API' }).click()

  await expect(page.getByRole('heading', { name: 'Tus claves, bajo control.' })).toBeVisible()
  await page.getByRole('button', { name: 'Nueva clave' }).click()
  await page.getByLabel('Nombre de la aplicación').fill('Portal de pruebas')
  await page.getByPlaceholder('p. ej. equipo de producto').fill('Equipo web')
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
  await page.getByRole('button', { name: 'Portal de pruebas' }).click()
  await expect(page.getByRole('dialog', { name: 'Portal de pruebas' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Portal de pruebas' }).getByText('rlv_4ad28f10••••••••')).toBeVisible()
  await expect(page.getByText(secret)).toHaveCount(0)
  await page.getByRole('button', { name: 'Cerrar detalles' }).click()
  await page.getByRole('button', { name: 'Revocar', exact: true }).click()
  await page.getByRole('button', { name: 'Revocar acceso' }).click()
  await expect(page.locator('.key-row').filter({ hasText: 'Portal de pruebas' }).getByText('Revocada', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Conectar una app' }).click()
  await expect(page.getByText('http://127.0.0.1:8765/v1', { exact: true })).toBeVisible()
  await expect(page.getByText('La clave “Portal de pruebas” quedó revocada.')).toBeVisible()
})

test('API playground chats with a selected key/model and sends image attachments', async ({ page }) => {
  let lastChat: { api_key_id: number; model: string; messages: { role: string; content: string | { type: string; image_url?: { url: string } }[] }[] } | undefined
  await page.route('**/admin/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/admin/auth/login') {
      await route.fulfill({ json: { access_token: 'e2e-admin-token', token_type: 'bearer' } })
      return
    }
    if (pathname === '/admin/api-keys') {
      await route.fulfill({ json: [{ id: 4, name: 'Aplicación web', prefix: 'a1b2c3d4', owner: null, is_active: true, requests_per_minute: 60 }] })
      return
    }
    if (pathname === '/admin/playground/catalog') {
      await route.fulfill({ json: {
        api_keys: [{ id: 4, name: 'Aplicación web', prefix: 'a1b2c3d4', owner: null, requests_per_minute: 60 }],
        models: [{ id: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile', alias: null, provider: 'groq', provider_name: 'Groq', capabilities: ['text', 'vision'] }],
      } })
      return
    }
    if (pathname === '/admin/playground/chat' && route.request().method() === 'POST') {
      lastChat = route.request().postDataJSON() as typeof lastChat
      await route.fulfill({ json: {
        choices: [{ message: { role: 'assistant', content: 'Respuesta de prueba de Relevo.' } }],
        relevo: { model: lastChat?.model === 'auto' ? 'llama-3.3-70b-versatile' : lastChat?.model, provider: 'groq', attempts: 1 },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { detail: 'Unexpected test request' } })
  })

  await page.goto('')
  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await page.getByRole('button', { name: 'Playground' }).click()

  await expect(page.getByRole('heading', { name: 'Chat API' })).toBeVisible()
  await expect(page.getByLabel('Clave API')).toContainText('Aplicación web')
  await expect(page.getByLabel('Modelo', { exact: true })).toContainText('Automático · reintenta con otros modelos')
  await expect(page.getByLabel('Modelo', { exact: true })).toContainText('llama-3.3-70b-versatile · Groq · visión')

  await page.getByLabel('Modelo', { exact: true }).selectOption('llama-3.3-70b-versatile')
  await page.getByLabel('Escribe un mensaje').fill('¿Qué aparece en esta imagen?')
  await page.getByLabel('Subir imágenes').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=', 'base64'),
  })
  await expect(page.getByAltText('pixel.png')).toBeVisible()
  await page.getByRole('button', { name: 'Enviar mensaje' }).click()
  await expect(page.getByText('Respuesta de prueba de Relevo.')).toBeVisible()
  expect(lastChat?.api_key_id).toBe(4)
  expect(lastChat?.model).toBe('llama-3.3-70b-versatile')
  expect(lastChat?.messages[0].content).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'image_url', image_url: expect.objectContaining({ url: expect.stringMatching(/^data:image\/png;base64,/) }) }),
  ]))

  await page.getByLabel('Modelo', { exact: true }).selectOption('auto')
  await page.getByLabel('Escribe un mensaje').fill('Continúa en modo automático')
  await page.getByRole('button', { name: 'Enviar mensaje' }).click()
  await expect(page.getByText('Respuesta de prueba de Relevo.').last()).toBeVisible()
  expect(lastChat?.model).toBe('auto')

  const image = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=', 'base64') })
  await page.getByRole('button', { name: 'Nueva conversación' }).click()
  await page.getByLabel('Subir imágenes').setInputFiles(['uno.png', 'dos.png', 'tres.png', 'cuatro.png'].map(image))
  await expect(page.locator('.image-attachment')).toHaveCount(4)
  await page.getByLabel('Subir imágenes').setInputFiles(image('cinco.png'))
  await expect(page.getByRole('alert')).toContainText('Puedes adjuntar hasta 4 imágenes')
  await expect(page.locator('.image-attachment')).toHaveCount(4)
  await page.getByRole('button', { name: 'Nueva conversación' }).click()
  await expect(page.locator('.image-attachment')).toHaveCount(0)
  await expect(page.getByText('Respuesta de prueba de Relevo.')).toHaveCount(0)
  await page.getByLabel('Subir imágenes').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
  await expect(page.getByRole('alert')).toContainText('Cada imagen debe pesar como máximo 5 MB')
  await expect(page.locator('.image-attachment')).toHaveCount(0)
})

test('T061/T067/T071 parcial: navegador se conecta a FastAPI y gestiona una clave', async ({ page }) => {
  await page.goto('')
  await page.getByLabel('Correo de administrador').fill('playwright-admin@example.com')
  await page.getByLabel('Contraseña').fill('playwright-only-password')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await page.getByRole('button', { name: 'Claves API' }).click()
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
  await expect(page.getByRole('heading', { name: 'Qué bueno verte de nuevo.' })).toBeVisible()
  const loginAudit = await new AxeBuilder({ page }).analyze()
  expect(loginAudit.violations).toEqual([])

  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.route('**/admin/auth/login', (route) => route.fulfill({ json: { access_token: 'e2e-admin-token' } }))
  await page.route('**/admin/api-keys', (route) => route.fulfill({ json: [] }))
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
  await page.getByRole('button', { name: 'Claves API' }).click()
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
  await page.getByRole('button', { name: 'Claves API' }).click()
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
  await page.getByRole('button', { name: 'Claves API' }).click()
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
