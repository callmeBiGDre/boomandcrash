// Netlify function: fetches latest tick from Deriv server-side (bypasses ISP block)
// Called by browser via HTTP GET /.netlify/functions/tick?symbol=BOOM500

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  const symbol = event.queryStringParameters?.symbol || 'BOOM500'
  const token  = process.env.DERIV_TOKEN || ''

  // Use node WebSocket to connect server-side
  const WebSocket = require('ws')

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        statusCode: 504,
        headers,
        body: JSON.stringify({ error: 'Deriv connection timed out' })
      })
    }, 9000)

    let ws
    try {
      ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=32CU4vIdad1kjw93ULFI8`)
    } catch (e) {
      clearTimeout(timeout)
      return resolve({ statusCode: 500, headers, body: JSON.stringify({ error: e.message }) })
    }

    let authorized = false

    ws.on('open', () => {
      ws.send(JSON.stringify({ authorize: token }))
    })

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw)

        if (data.msg_type === 'authorize') {
          if (data.error) {
            clearTimeout(timeout)
            ws.close()
            return resolve({ statusCode: 200, headers, body: JSON.stringify({ error: 'auth: ' + data.error.message }) })
          }
          authorized = true
          ws.send(JSON.stringify({ ticks: symbol }))
        }

        if (data.msg_type === 'tick') {
          clearTimeout(timeout)
          ws.close()
          resolve({
            statusCode: 200,
            headers,
            body: JSON.stringify({
              symbol: data.tick.symbol,
              price:  data.tick.quote,
              time:   data.tick.epoch,
              ok:     true
            })
          })
        }

        if (data.error && data.msg_type !== 'authorize') {
          clearTimeout(timeout)
          ws.close()
          resolve({ statusCode: 200, headers, body: JSON.stringify({ error: data.error.message }) })
        }
      } catch (e) {
        clearTimeout(timeout)
        ws.close()
        resolve({ statusCode: 500, headers, body: JSON.stringify({ error: e.message }) })
      }
    })

    ws.on('error', (e) => {
      clearTimeout(timeout)
      resolve({ statusCode: 500, headers, body: JSON.stringify({ error: 'WS error: ' + e.message }) })
    })
  })
}
