import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const suffix = `${process.pid}`
const network = `relevo-image-test-net-${suffix}`
const mysql = `relevo-image-test-mysql-${suffix}`
const app = `relevo-image-test-app-${suffix}`
const image = `relevo-image-test:${suffix}`
const port = process.env.RELEVO_E2E_IMAGE_PORT || '8767'
const mysqlPassword = 'image-test-mysql-password'
const mysqlRootPassword = 'image-test-root-password'
const adminEmail = 'image-test-admin@example.com'
const adminPassword = 'image-test-admin-password-only'
const providerSecret = 'playwright-provider-secret'
let provider

function docker(args, options = {}) {
  return spawnSync('docker', args, { cwd: workspace, stdio: 'inherit', ...options })
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

function requiredDocker(args) {
  const result = docker(args)
  if (result.status !== 0) throw new Error(`Docker falló: ${args[0]}`)
}

async function expectStatus(response, status, action) {
  if (response.status !== status) {
    throw new Error(`${action}: esperado HTTP ${status}, recibido ${response.status}: ${await response.text()}`)
  }
}

async function request(baseUrl, route, options) {
  const response = await fetch(`${baseUrl}${route}`, options)
  return response
}

let exitCode = 1
try {
  requiredDocker(['network', 'create', network])
  requiredDocker([
    'build', '--tag', image, '.',
  ])
  requiredDocker([
    'run', '--detach', '--name', mysql, '--network', network, '--network-alias', 'mysql',
    '--env', 'MYSQL_DATABASE=relevo_image_test', '--env', 'MYSQL_USER=relevo_image_test',
    '--env', `MYSQL_PASSWORD=${mysqlPassword}`, '--env', `MYSQL_ROOT_PASSWORD=${mysqlRootPassword}`,
    'mysql:8.0',
  ])

  const deadline = Date.now() + 120_000
  let databaseReady = false
  while (Date.now() < deadline) {
    const ping = spawnSync('docker', [
      'exec', '--env', `MYSQL_PWD=${mysqlRootPassword}`, mysql,
      'mysqladmin', 'ping', '--host=127.0.0.1', '--user=root', '--silent',
    ], { cwd: workspace, stdio: 'ignore' })
    if (ping.status === 0) { databaseReady = true; break }
    await delay(1500)
  }
  if (!databaseReady) throw new Error('MySQL del smoke test no estuvo listo en 120 segundos.')

  provider = spawn(process.execPath, [path.join(workspace, 'scripts', 'mock-provider.mjs')], {
    cwd: workspace,
    stdio: 'ignore',
    env: { ...process.env },
  })
  await delay(500)
  requiredDocker([
    'run', '--detach', '--name', app, '--network', network, '--publish', `127.0.0.1:${port}:8000`,
    '--add-host', 'host.docker.internal:host-gateway',
    '--env', 'APP_ENV=development', '--env', 'MYSQL_HOST=mysql', '--env', 'MYSQL_PORT=3306',
    '--env', 'MYSQL_DATABASE=relevo_image_test', '--env', 'MYSQL_USER=relevo_image_test',
    '--env', `MYSQL_PASSWORD=${mysqlPassword}`, '--env', `MYSQL_ROOT_PASSWORD=${mysqlRootPassword}`,
    '--env', `ADMIN_EMAIL=${adminEmail}`, '--env', `ADMIN_PASSWORD=${adminPassword}`,
    '--env', 'JWT_SECRET=image-test-jwt-secret-long-enough-for-local-run',
    '--env', 'API_KEY_PEPPER=image-test-api-key-pepper-long-enough-local',
    '--env', `GROQ_API_KEY=${providerSecret}`,
    '--env', 'CORS_ORIGINS=https://allowed.example',
    image,
  ])

  const baseUrl = `http://127.0.0.1:${port}`
  let healthy = false
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) { healthy = true; break }
    } catch { /* Wait for database migrations and app startup. */ }
    await delay(1500)
  }
  if (!healthy) throw new Error('La imagen final no respondió en /health.')
  const consoleResponse = await fetch(`${baseUrl}/console/`)
  await expectStatus(consoleResponse, 200, 'Servir consola React desde la imagen')
  if (!(await consoleResponse.text()).includes('<div id="root">')) {
    throw new Error('La página de consola de la imagen no contiene la aplicación React.')
  }
  await expectStatus(await fetch(`${baseUrl}/ready`), 200, 'La imagen informa disponibilidad')

  const login = await request(baseUrl, '/admin/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  })
  await expectStatus(login, 200, 'Login de administrador en la imagen')
  const { access_token: token } = await login.json()
  const adminHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const providerBase = 'http://host.docker.internal:8766/v1'
  const primary = await request(baseUrl, '/admin/providers/image-test-primary', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ name: 'Image test primary', base_url: providerBase, env_key_name: 'GROQ_API_KEY' }),
  })
  await expectStatus(primary, 200, 'Configurar proveedor simulado primario')
  const secondary = await request(baseUrl, '/admin/providers/image-test-secondary', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ name: 'Image test secondary', base_url: providerBase, env_key_name: 'GROQ_API_KEY' }),
  })
  await expectStatus(secondary, 200, 'Configurar proveedor simulado alternativo')
  const primaryProvider = await primary.json()
  const secondaryProvider = await secondary.json()
  let imagePrimaryModelId
  for (const [providerId, modelName, tier] of [
    [primaryProvider.id, 'pw-primary-429', 0], [secondaryProvider.id, 'pw-secondary', 1],
  ]) {
    const model = await request(baseUrl, '/admin/models', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ provider_id: providerId, name: modelName, alias: `${modelName}-image`, tier, priority: 1, capabilities: ['text'] }),
    })
    await expectStatus(model, 201, `Crear modelo simulado ${modelName}`)
    if (modelName === 'pw-primary-429') imagePrimaryModelId = (await model.json()).id
  }
  const createdKeyResponse = await request(baseUrl, '/admin/api-keys', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ name: 'Image test key', requests_per_minute: 25 }),
  })
  await expectStatus(createdKeyResponse, 201, 'Crear clave desde la API de la imagen')
  const { id: keyId, api_key: key } = await createdKeyResponse.json()
  const chat = await request(baseUrl, '/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'Smoke test Docker' }] }),
  })
  await expectStatus(chat, 200, 'Chat con fallback en la imagen final')
  if (chat.headers.get('x-relevo-provider') !== 'image-test-secondary' || chat.headers.get('x-relevo-attempts') !== '2') {
    throw new Error('La imagen no completó el fallback del proveedor simulado como se esperaba.')
  }
  const allowedPreflight = await request(baseUrl, '/v1/models', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://allowed.example',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  })
  await expectStatus(allowedPreflight, 200, 'Preflight CORS desde origen permitido')
  if (allowedPreflight.headers.get('access-control-allow-origin') !== 'https://allowed.example') {
    throw new Error('La imagen no emitió la cabecera CORS del origen permitido.')
  }
  const deniedPreflight = await request(baseUrl, '/v1/models', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://blocked.example',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  })
  if (deniedPreflight.headers.get('access-control-allow-origin')) {
    throw new Error('La imagen autorizó por CORS un origen que no está configurado.')
  }

  docker(['stop', app], { stdio: 'ignore' })
  requiredDocker(['restart', mysql])
  let mysqlReady = false
  const mysqlDeadline = Date.now() + 120_000
  while (Date.now() < mysqlDeadline) {
    const ping = spawnSync('docker', [
      'exec', '--env', `MYSQL_PWD=${mysqlRootPassword}`, mysql,
      'mysqladmin', 'ping', '--host=127.0.0.1', '--user=root', '--silent',
    ], { cwd: workspace, stdio: 'ignore' })
    if (ping.status === 0) { mysqlReady = true; break }
    await delay(1500)
  }
  if (!mysqlReady) throw new Error('MySQL no se recuperó del reinicio para T093.')
  requiredDocker(['start', app])
  let appReady = false
  const appDeadline = Date.now() + 120_000
  while (Date.now() < appDeadline) {
    try {
      const response = await fetch(`${baseUrl}/ready`)
      if (response.ok) { appReady = true; break }
    } catch { /* Wait while the app reapplies migrations and reconnects. */ }
    await delay(1500)
  }
  if (!appReady) throw new Error('La aplicación no recuperó disponibilidad tras reiniciar MySQL para T093.')
  const persistedKey = await request(baseUrl, '/v1/models', { headers: { authorization: `Bearer ${key}` } })
  await expectStatus(persistedKey, 200, 'Conservar clave y catálogo después de reiniciar API y MySQL')
  const persistedChat = await request(baseUrl, '/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'After restart' }] }),
  })
  await expectStatus(persistedChat, 200, 'Conservar modelos y fallback después del reinicio')

  const revoke = await request(baseUrl, `/admin/api-keys/${keyId}`, { method: 'DELETE', headers: adminHeaders })
  await expectStatus(revoke, 204, 'Revocar clave de prueba')
  const denied = await request(baseUrl, '/v1/models', { headers: { authorization: `Bearer ${key}` } })
  await expectStatus(denied, 401, 'Denegar clave revocada')

  const resetCooldown = await request(baseUrl, `/admin/models/${imagePrimaryModelId}/reset-cooldown`, {
    method: 'POST', headers: adminHeaders,
  })
  await expectStatus(resetCooldown, 200, 'Restablecer cooldown para el flujo de navegador T092')

  const { chromium } = await import(pathToFileURL(path.join(workspace, 'web', 'node_modules', 'playwright', 'index.mjs')).href)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(`${baseUrl}/console/`)
    await page.getByLabel('Correo de administrador').fill(adminEmail)
    await page.getByLabel('Contraseña').fill(adminPassword)
    await page.getByRole('button', { name: 'Entrar al panel' }).click()
    await page.getByRole('heading', { name: 'Tus claves, bajo control.' }).waitFor()
    await page.getByRole('button', { name: 'Nueva clave' }).click()
    await page.getByLabel('Nombre de la aplicación').fill('Docker UI test key')
    await page.getByRole('button', { name: 'Crear clave' }).click()
    await page.getByRole('heading', { name: 'Guárdala ahora.' }).waitFor()
    await page.getByRole('button', { name: 'Mostrar' }).click()
    const browserKey = await page.locator('.secret-box code').innerText()
    const browserChat = await request(baseUrl, '/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${browserKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'Docker browser end to end' }] }),
    })
    await expectStatus(browserChat, 200, 'Chat con la clave creada desde la consola Docker')
    if (browserChat.headers.get('x-relevo-provider') !== 'image-test-secondary' || browserChat.headers.get('x-relevo-attempts') !== '2') {
      throw new Error('La consola Docker no conservó el fallback 429 en su recorrido integrado T092.')
    }
    await page.getByRole('button', { name: 'Ya la guardé' }).click()
    const keyRow = page.locator('.key-row').filter({ hasText: 'Docker UI test key' })
    await keyRow.getByRole('button', { name: 'Revocar' }).click()
    await page.getByRole('button', { name: 'Revocar acceso' }).click()
    await keyRow.getByText('Revocada', { exact: true }).waitFor()
    const browserKeyDenied = await request(baseUrl, '/v1/models', { headers: { authorization: `Bearer ${browserKey}` } })
    await expectStatus(browserKeyDenied, 401, 'Denegar clave creada por interfaz después de revocarla')
    if (pageErrors.length) throw new Error(`La consola Docker reportó errores: ${pageErrors.join('; ')}`)
  } finally {
    await browser.close()
  }

  docker(['stop', app], { stdio: 'ignore' })
  const backup = spawnSync('docker', [
    'exec', '--env', `MYSQL_PWD=${mysqlRootPassword}`, mysql,
    'mysqldump', '--user=root', '--single-transaction', '--databases', 'relevo_image_test',
  ], { cwd: workspace, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (backup.status !== 0 || !backup.stdout.includes('CREATE DATABASE')) {
    throw new Error('No se pudo crear el respaldo MySQL para T098.')
  }
  const recreate = spawnSync('docker', [
    'exec', '--env', `MYSQL_PWD=${mysqlRootPassword}`, mysql, 'mysql', '--user=root',
    '--execute', 'DROP DATABASE relevo_image_test; CREATE DATABASE relevo_image_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
  ], { cwd: workspace, encoding: 'utf8' })
  if (recreate.status !== 0) throw new Error('No se pudo recrear la base limpia para T098.')
  const restore = spawnSync('docker', [
    'exec', '--interactive', '--env', `MYSQL_PWD=${mysqlRootPassword}`, mysql, 'mysql', '--user=root',
  ], { cwd: workspace, input: backup.stdout, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (restore.status !== 0) throw new Error('No se pudo restaurar el respaldo MySQL para T098.')
  requiredDocker(['start', app])
  let restoredAppReady = false
  const restoreDeadline = Date.now() + 120_000
  while (Date.now() < restoreDeadline) {
    try {
      const response = await fetch(`${baseUrl}/ready`)
      if (response.ok) { restoredAppReady = true; break }
    } catch { /* Wait for the restored database and app to reconnect. */ }
    await delay(1500)
  }
  if (!restoredAppReady) throw new Error('La aplicación no quedó lista después de restaurar el respaldo.')
  const restoredKeys = await request(baseUrl, '/admin/api-keys', { headers: adminHeaders })
  await expectStatus(restoredKeys, 200, 'Leer claves restauradas')
  const restoredKeyRows = await restoredKeys.json()
  if (!restoredKeyRows.some((row) => row.id === keyId && !row.is_active)) {
    throw new Error('El respaldo restaurado no conservó el estado revocado de la clave.')
  }
  const restoredRevocation = await request(baseUrl, '/v1/models', { headers: { authorization: `Bearer ${key}` } })
  await expectStatus(restoredRevocation, 401, 'Conservar revocación tras restaurar respaldo')

  process.stdout.write('Docker image smoke test: health, Alembic, React, browser create/use/revoke, CORS, restart persistence and MySQL backup/restore passed.\n')
  exitCode = 0
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
} finally {
  provider?.kill()
  docker(['rm', '--force', app], { stdio: 'ignore' })
  docker(['rm', '--force', mysql], { stdio: 'ignore' })
  docker(['network', 'rm', network], { stdio: 'ignore' })
  docker(['image', 'rm', '--force', image], { stdio: 'ignore' })
}
process.exit(exitCode)
