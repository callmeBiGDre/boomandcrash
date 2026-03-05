// Netlify function: fetches latest tick from Deriv
// Uses ws package with explicit connect timeout handling

const WebSocket = require('ws')

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

  if (!token) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'DERIV_TOKEN not set in environment variables' })
    }
  }

  return new Promise((resolve) => {
    let settled = false

    function done(result) {
      if (settled) return
      settled = true
      try { ws && ws.readyState === WebSocket.OPEN && ws.close() } catch (_) {}
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      done({
        statusCode: 504,
        headers,
        body: JSON.stringify({ error: 'Deriv connection timed out after 8s' })
      })
    }, 8000)

    let ws
    try {
      ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=32CU4vIdad1kjw93ULFI8')
    } catch (e) {
      return done({ statusCode: 500, headers, body: JSON.stringify({ error: 'WS init: ' + e.message }) })
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({ authorize: token }))
    })

    ws.on('message', (raw) => {
      let data
      try { data = JSON.parse(raw) } catch (e) {
        return done({ statusCode: 500, headers, body: JSON.stringify({ error: 'JSON parse: ' + e.message }) })
      }

      if (data.msg_type === 'authorize') {
        if (data.error) {
          return done({
            statusCode: 200,
            headers,
            body: JSON.stringify({ error: 'Auth failed: ' + data.error.message + ' (code: ' + data.error.code + ')' })
          })
        }
        // Authorized — now subscribe to ticks
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }))
      }

      if (data.msg_type === 'tick') {
        return done({
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
        return done({
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: data.error.message + ' (code: ' + data.error.code + ')' })
        })
      }
    })

    ws.on('error', (e) => {
      done({ statusCode: 500, headers, body: JSON.stringify({ error: 'WS error: ' + e.message }) })
    })

    ws.on('close', (code, reason) => {
      if (!settled) {
        done({
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'WS closed unexpectedly: code=' + code + ' reason=' + reason })
        })
      }
    })
  })
}
