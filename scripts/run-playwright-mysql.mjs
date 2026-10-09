import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const webDirectory = path.join(workspace, 'web')
const containerName = `relevo-playwright-mysql-${process.pid}`
const mysqlPort = process.env.RELEVO_E2E_MYSQL_PORT || '3337'
const mysqlUser = 'relevo_e2e'
const mysqlPassword = 'playwright-mysql-only-password'
const mysqlRootPassword = 'playwright-mysql-root-only-password'

function runDocker(args, options = {}) {
  return spawnSync('docker', args, { cwd: workspace, stdio: 'inherit', ...options })
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

const start = runDocker([
  'run', '--rm', '--detach', '--name', containerName,
  '--publish', `127.0.0.1:${mysqlPort}:3306`,
  '--env', `MYSQL_ROOT_PASSWORD=${mysqlRootPassword}`,
  '--env', 'MYSQL_DATABASE=relevo_e2e',
  '--env', `MYSQL_USER=${mysqlUser}`,
  '--env', `MYSQL_PASSWORD=${mysqlPassword}`,
  'mysql:8.0',
])

if (start.status !== 0) {
  process.exit(start.status ?? 1)
}

let exitCode = 1
try {
  const deadline = Date.now() + 120_000
  let ready = false
  while (Date.now() < deadline) {
    const ping = spawnSync('docker', [
      'exec', '--env', `MYSQL_PWD=${mysqlRootPassword}`, containerName,
      'mysqladmin', 'ping', '--host=127.0.0.1', '--user=root', '--silent',
    ], { cwd: workspace, stdio: 'ignore' })
    if (ping.status === 0) {
      ready = true
      break
    }
    if (ping.error) throw ping.error
    await delay(1500)
  }
  if (!ready) throw new Error('MySQL de prueba no estuvo listo en 120 segundos.')

  const databaseUrl = `mysql+asyncmy://${mysqlUser}:${mysqlPassword}@127.0.0.1:${mysqlPort}/relevo_e2e?charset=utf8mb4`
  const python = process.platform === 'win32'
    ? path.join(workspace, '.venv', 'Scripts', 'python.exe')
    : 'python'
  const migrations = spawnSync(python, ['-m', 'alembic', 'upgrade', 'head'], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })
  if (migrations.status !== 0) throw new Error('Las migraciones Alembic no se aplicaron a MySQL temporal.')

  const playwrightCli = path.join(webDirectory, 'node_modules', '@playwright', 'test', 'cli.js')
  exitCode = await runChild(process.execPath, [playwrightCli, 'test', '--workers=1'], {
    cwd: webDirectory,
    env: {
      ...process.env,
      RELEVO_E2E_DATABASE_URL: databaseUrl,
      RELEVO_E2E_DATABASE_AUTO_CREATE: 'false',
    },
    stdio: 'inherit',
  })
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  exitCode = 1
} finally {
  const cleanup = runDocker(['rm', '--force', containerName])
  if (cleanup.status !== 0) exitCode ||= cleanup.status ?? 1
}

process.exit(exitCode)
