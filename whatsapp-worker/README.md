# WhatsApp Worker — Baileys QR Pairing Service

Persistent Node.js process that manages WhatsApp connections using the WhatsApp Web protocol (Baileys).

> ⚠️ **IMPORTANT:** This worker CANNOT run on Vercel serverless functions.
> It requires a **persistent process** with WebSocket connectivity to WhatsApp servers.

## Deployment Options

| Platform | Free Tier | Persistence | Recommended |
|----------|-----------|-------------|-------------|
| **Railway** | ✅ | ✅ | ⭐ Best choice |
| **Render** | ✅ | ✅ | Good |
| **Fly.io** | ✅ | ✅ | Good |
| **VPS** | ❌ | ✅ | Full control |
| **Vercel** | ✅ | ❌ | ❌ Won't work |

## Setup

```bash
cd whatsapp-worker
npm install

# Create .env
cat > .env << 'EOF'
WORKER_PORT=3001
WORKER_API_KEY=your-secure-api-key-here
CREDENTIALS_ENCRYPTION_KEY=your-64-char-hex-key
EOF

npm start
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `WORKER_PORT` | Port for the HTTP API | `3001` |
| `WORKER_API_KEY` | Secret key for Next.js → Worker auth | Random 32+ chars |
| `CREDENTIALS_ENCRYPTION_KEY` | AES-256-GCM key for encrypting sessions | `openssl rand -hex 32` |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| GET | `/status` | ✅ | Connection status |
| GET | `/qr` | ✅ | Get current QR code (base64) |
| POST | `/connect` | ✅ | Start connection / generate QR |
| POST | `/disconnect` | ✅ | Disconnect and clear session |
| POST | `/send` | ✅ | Send message `{ to, text }` |

## Next.js Configuration

Add these to your Next.js `.env.local`:

```env
WHATSAPP_WORKER_URL=https://your-worker.railway.app
WORKER_API_KEY=your-secure-api-key-here
```

## Railway Deployment

1. Create a new project on [Railway](https://railway.app)
2. Connect your GitHub repo
3. Set root directory to `whatsapp-worker/`
4. Add environment variables (see above)
5. Deploy — Railway auto-detects Node.js

## Risk Disclaimer

Baileys uses the WhatsApp Web protocol, which is **not officially supported** by Meta.

- ⚠️ Account ban risk exists for unauthorized automated usage
- ✅ Use with a **dedicated business number**, not personal
- ✅ Respect WhatsApp Terms of Service
- ✅ Rate-limit outgoing messages (max ~10/minute)
- ✅ Implement human handoff for customer support

## Testing

```bash
# Health check
curl http://localhost:3001/health

# Start connection (generates QR)
curl -X POST http://localhost:3001/connect \
  -H "x-worker-key: your-api-key"

# Get QR code
curl http://localhost:3001/qr \
  -H "x-worker-key: your-api-key"

# Check status
curl http://localhost:3001/status \
  -H "x-worker-key: your-api-key"

# Send message
curl -X POST http://localhost:3001/send \
  -H "x-worker-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"to": "201012345678", "text": "Hello!"}'
```
