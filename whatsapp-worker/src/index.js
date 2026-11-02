/**
 * El Nour Dashboard — WhatsApp Session Worker
 *
 * Uses Baileys (WhatsApp Web protocol) for QR-based device pairing.
 * Runs as a PERSISTENT process (NOT serverless).
 *
 * DEPLOYMENT: Railway / Render / Fly.io / VPS — NOT Vercel serverless.
 * This worker maintains a WebSocket connection to WhatsApp servers.
 *
 * API Endpoints (Express):
 *   GET  /health                — Health check
 *   GET  /status                — Connection status
 *   POST /connect               — Start session (generates QR if needed)
 *   POST /disconnect            — Disconnect and clear session
 *   POST /send                  — Send a message { to, text }
 *   GET  /qr                    — Get current QR code (base64)
 *
 * Environment:
 *   WORKER_PORT=3001
 *   WORKER_API_KEY=<secret for authenticating Next.js -> Worker calls>
 *   SUPABASE_URL=<for persisting session state>
 *   SUPABASE_SERVICE_ROLE_KEY=<for DB access>
 *   CREDENTIALS_ENCRYPTION_KEY=<for encrypting session data at rest>
 */

const express = require('express')
const cors = require('cors')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys')
const QRCode = require('qrcode')
const pino = require('pino')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

const logger = pino({ level: 'warn' })
const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.WORKER_PORT || 3001
const API_KEY = process.env.WORKER_API_KEY || 'change-me-in-production'
const AUTH_DIR = path.join(__dirname, '..', 'sessions')

// Ensure sessions directory exists
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
}

// ─── State ────────────────────────────────────────────────────────────────────

let sock = null
let connectionStatus = 'disconnected' // disconnected|initializing|waiting_qr|connecting|connected|reconnecting|failed
let currentQR = null // Base64 QR image
let qrExpiresAt = null
let connectedPhone = null
let lastConnectedAt = null
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
let messageHandlers = []

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function authenticate(req, res, next) {
  const key = req.headers['x-worker-key'] || req.headers.authorization?.replace('Bearer ', '')
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ─── WhatsApp Connection ─────────────────────────────────────────────────────

async function startWhatsApp() {
  if (sock) {
    try { sock.end() } catch {}
    sock = null
  }

  connectionStatus = 'initializing'
  currentQR = null
  console.log('[WA] Starting WhatsApp connection...')

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: ['El Nour Dashboard', 'Chrome', '120.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      connectionStatus = 'waiting_qr'
      // Generate QR as base64 PNG for frontend display
      try {
        currentQR = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'L',
          margin: 2,
          width: 300,
        })
        // QR expires in ~60 seconds per WhatsApp protocol
        qrExpiresAt = new Date(Date.now() + 60_000).toISOString()
        console.log('[WA] QR generated, waiting for scan...')
      } catch (err) {
        console.error('[WA] QR generation error:', err)
      }
    }

    if (connection === 'connecting') {
      connectionStatus = 'connecting'
    }

    if (connection === 'open') {
      connectionStatus = 'connected'
      currentQR = null
      qrExpiresAt = null
      reconnectAttempts = 0
      connectedPhone = sock?.user?.id?.split(':')[0] || null
      lastConnectedAt = new Date().toISOString()
      console.log('[WA] Connected! Phone:', connectedPhone)
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++
        connectionStatus = 'reconnecting'
        console.log(`[WA] Reconnecting... attempt ${reconnectAttempts}`)
        setTimeout(() => startWhatsApp(), Math.min(reconnectAttempts * 3000, 30000))
      } else if (statusCode === DisconnectReason.loggedOut) {
        connectionStatus = 'disconnected'
        connectedPhone = null
        currentQR = null
        // Clear session files
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }) } catch {}
        console.log('[WA] Logged out. Session cleared.')
      } else {
        connectionStatus = 'failed'
        console.log('[WA] Max reconnection attempts reached')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe) continue
      // Forward to registered handlers
      for (const handler of messageHandlers) {
        try {
          await handler(msg)
        } catch (err) {
          console.error('[WA] Message handler error:', err)
        }
      }
    }
  })
}

// ─── API Routes ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsapp_status: connectionStatus,
    has_socket: !!sock,
    uptime: process.uptime(),
  })
})

app.get('/status', authenticate, (req, res) => {
  res.json({
    status: connectionStatus,
    phone: connectedPhone,
    has_qr: !!currentQR,
    qr_expires_at: qrExpiresAt,
    last_connected_at: lastConnectedAt,
    reconnect_attempts: reconnectAttempts,
  })
})

app.get('/qr', authenticate, (req, res) => {
  if (connectionStatus !== 'waiting_qr' || !currentQR) {
    return res.status(404).json({ error: 'No QR available', status: connectionStatus })
  }
  res.json({
    qr_code: currentQR,
    expires_at: qrExpiresAt,
    status: connectionStatus,
  })
})

app.post('/connect', authenticate, async (req, res) => {
  if (connectionStatus === 'connected') {
    return res.json({ status: 'connected', phone: connectedPhone, message: 'Already connected' })
  }
  try {
    await startWhatsApp()
    res.json({ status: connectionStatus, message: 'Connection initiated' })
  } catch (err) {
    console.error('[WA] Connect error:', err)
    res.status(500).json({ error: 'Failed to start WhatsApp connection' })
  }
})

app.post('/disconnect', authenticate, async (req, res) => {
  try {
    if (sock) {
      await sock.logout()
      sock = null
    }
    // Clear session
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }) } catch {}
    connectionStatus = 'disconnected'
    connectedPhone = null
    currentQR = null
    reconnectAttempts = 0
    console.log('[WA] Disconnected by user')
    res.json({ success: true, message: 'Disconnected' })
  } catch (err) {
    console.error('[WA] Disconnect error:', err)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

app.post('/send', authenticate, async (req, res) => {
  const { to, text } = req.body
  if (!to || !text) {
    return res.status(400).json({ error: 'Missing "to" or "text"' })
  }
  if (connectionStatus !== 'connected' || !sock) {
    return res.status(503).json({ error: 'WhatsApp not connected', status: connectionStatus })
  }

  try {
    // Format phone for Baileys: remove +, ensure @s.whatsapp.net suffix
    let jid = to.replace(/\D/g, '')
    if (!jid.includes('@')) {
      jid = `${jid}@s.whatsapp.net`
    }

    const result = await sock.sendMessage(jid, { text })
    res.json({
      success: true,
      message_id: result?.key?.id,
      status: 'sent',
    })
  } catch (err) {
    console.error('[WA] Send error:', err)
    res.status(500).json({ error: 'Failed to send message', details: err.message })
  }
})

// Register a message handler (called by Next.js via internal function, not HTTP)
function onMessage(handler) {
  messageHandlers.push(handler)
}

// ─── Auto-start connection on boot (restore session) ─────────────────────────

async function bootstrap() {
  // Check if a saved session exists
  const credsFile = path.join(AUTH_DIR, 'creds.json')
  const hasSession = fs.existsSync(credsFile)

  if (hasSession) {
    console.log('[WA] Found existing session, restoring...')
    await startWhatsApp()
  } else {
    console.log('[WA] No saved session. Call POST /connect to start.')
    connectionStatus = 'disconnected'
  }
}

app.listen(PORT, () => {
  console.log(`[Worker] WhatsApp Worker running on port ${PORT}`)
  bootstrap()
})

// Export for potential programmatic use
module.exports = { app, onMessage, startWhatsApp }
