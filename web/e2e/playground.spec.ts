import { expect, test } from '@playwright/test'

test('automatic and manual modes stream routing, provider output and saved chat history', async ({ page }) => {
  const routing = { task: 'reasoning', complexity: 'complex', confidence: 0.89, classifier: 'laya', classifier_ms: 63, fallback: null, mode: 'active' }
  const automaticStream = [
    { event: 'routing', elapsed_ms: 1, mode: 'auto' },
    { event: 'classified', elapsed_ms: 65, candidates: 2, routing },
    { event: 'selected', elapsed_ms: 70, model: 'overture-reasoning', provider: 'demo-provider', provider_name: 'Demo Provider', attempt: 1, routing },
    { event: 'requesting', elapsed_ms: 73, model: 'overture-reasoning', provider: 'demo-provider', attempt: 1 },
    { event: 'delta', elapsed_ms: 240, model: 'overture-reasoning', provider: 'demo-provider', text: 'Prepararía ' },
    { event: 'delta', elapsed_ms: 340, model: 'overture-reasoning', provider: 'demo-provider', text: 'el plan en tres pasos.' },
    { event: 'completed', elapsed_ms: 420, completion },
  ]
  await page.route('**/ready', (route) => route.fulfill({ json: { status: 'ok', database: 'ok', models: 'available' } }))
  await page.route('**/admin/auth/login', (route) => route.fulfill({ json: { access_token: 'e2e-admin-token' } }))
  await page.route('**/admin/api-keys', (route) => route.fulfill({ json: [{ id: 1, name: 'Pruebas locales', prefix: 'cafe9876', owner: 'QA', is_active: true, requests_per_minute: 60 }] }))
  await page.route('**/admin/playground/catalog', (route) => route.fulfill({ json: { api_keys: [{ id: 1, name: 'Pruebas locales', prefix: 'cafe9876', owner: 'QA', is_active: true, requests_per_minute: 60 }], models: [
    { id: 'overture-reasoning', name: 'overture-reasoning', alias: 'Overture Reasoning', provider: 'demo-provider', provider_name: 'Demo Provider', capabilities: ['text'] },
    { id: 'glass-image', name: 'glass-image', alias: 'Glass Image', provider: 'vision-provider', provider_name: 'Vision Provider', capabilities: ['text', 'vision'] },
  ] } }))
  const requestedModels: string[] = []
  await page.route('**/admin/playground/chat/stream', async (route) => {
    const request = route.request().postDataJSON() as { model: string }
    requestedModels.push(request.model)
    const manualModel = request.model !== 'auto'
    const routingEvent = manualModel ? { ...automaticStream[1], routing: null } : automaticStream[1]
    const selectionEvent = manualModel
      ? { ...automaticStream[2], model: request.model, provider_name: 'Vision Provider', routing: null }
      : automaticStream[2]
    const answer = manualModel ? 'Respuesta de modelo manual.' : 'Prepararía el plan en tres pasos.'
    const response = {
      choices: [{ message: { content: answer } }],
      usage: { prompt_tokens: 28, completion_tokens: 12, total_tokens: 40 },
      relevo: { model: selectionEvent.model, provider: selectionEvent.provider, attempts: 1, ...(manualModel ? {} : { routing }) },
    }
    const stream = [...automaticStream.slice(0, 1), routingEvent, selectionEvent,
      { ...automaticStream[3], model: selectionEvent.model },
      { ...automaticStream[4], model: selectionEvent.model, text: manualModel ? 'Respuesta de ' : 'Prepararía ' },
      { ...automaticStream[5], model: selectionEvent.model, text: manualModel ? 'modelo manual.' : 'el plan en tres pasos.' },
      { event: 'completed', elapsed_ms: 420, completion: response },
    ]
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
      body: `${stream.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('')}`,
    })
  })

  await page.goto('')
  await page.getByLabel('Correo de administrador').fill('admin@example.com')
  await page.getByLabel('Contraseña').fill('password-for-e2e')
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await page.getByRole('button', { name: 'Playground' }).click()
  await expect(page.getByRole('heading', { name: /El modelo adecuado/ })).toBeVisible()
  await expect(page.getByLabel('Seleccionar modelo: Automático')).toBeVisible()

  await page.getByLabel('Seleccionar modelo: Automático').click()
  await page.getByRole('button', { name: /overture-reasoning/ }).click()
  await expect(page.getByLabel('Seleccionar modelo: overture-reasoning')).toBeVisible()
  await page.getByRole('button', { name: 'Automático', exact: true }).click()

  await page.getByLabel('Escribe un mensaje').fill('Ayúdame a planificar una migración con varios riesgos y una reversión.')
  await page.getByLabel('Enviar mensaje').click()
  await expect(page.getByText('Prepararía el plan en tres pasos.')).toBeVisible()
  await expect(page.getByText('Análisis y planificación')).toBeVisible()
  await expect(page.getByText('overture-reasoning', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('40', { exact: true })).toBeVisible()
  await expect(page.getByText('Guardado')).toBeVisible()
  expect(requestedModels).toEqual(['auto'])

  await page.getByLabel('Seleccionar modelo: overture-reasoning').click()
  await page.getByRole('button', { name: /glass-image/ }).click()
  await page.getByLabel('Escribe un mensaje').fill('Ahora quiero elegir el modelo manualmente.')
  await page.getByLabel('Enviar mensaje').click()
  await expect(page.getByText('Respuesta de modelo manual.')).toBeVisible()
  expect(requestedModels).toEqual(['auto', 'glass-image'])

  await page.reload()
  await expect(page.getByText('Prepararía el plan en tres pasos.')).toBeVisible()
  await expect(page.getByText('Respuesta de modelo manual.')).toBeVisible()
  await expect(page.getByLabel('Seleccionar modelo: glass-image')).toBeVisible()
  await expect(page.getByLabel('Exportar conversación')).toBeEnabled()
})
