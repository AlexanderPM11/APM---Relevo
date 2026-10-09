import { createServer } from 'node:http'

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"status":"ok"}')
    return
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end()
    return
  }
  let body = ''
  for await (const chunk of request) body += chunk
  const payload = JSON.parse(body)
  if (request.headers.authorization !== 'Bearer playwright-provider-secret') {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end('{"error":{"message":"invalid test credential"}}')
    return
  }
  if (payload.model === 'pw-primary') {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end('{"error":{"message":"simulated temporary provider failure"}}')
    return
  }
  if (payload.model === 'pw-primary-429') {
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3' })
    response.end('{"error":{"message":"simulated provider rate limit"}}')
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    id: 'chatcmpl-playwright',
    object: 'chat.completion',
    created: 1,
    model: payload.model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'respuesta simulada' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  }))
})

server.listen(8766, '0.0.0.0')
