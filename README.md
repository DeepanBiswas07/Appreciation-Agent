<div align="center">

# 🕵️ Secret Appreciation Agent

**An anonymous, real-time appreciation game for office teams.**

*Think Secret Santa — but for kind words, encouragement, and genuine connection. All year round.*

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongoosejs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

</div>

---

## 🎯 What is it?

**Secret Appreciation Agent** is a web app built for office events and team-building activities. Every participant is secretly assigned as someone's "Appreciation Agent" — their mission is to send anonymous messages of encouragement, gratitude, or support to their assigned teammate throughout the event.

At the end of the round, identities are **revealed**, turning a week (or day) of mystery into a memorable team moment.

---

## 🗺️ How the Operation Runs

```
01 ASSIGN  →  02 CONNECT  →  03 GUESS  →  04 REVEAL
```

| Step | What Happens |
|:----:|-------------|
| **01 — Assign** | Everyone registers and gets secretly paired with an anonymous Appreciation Agent |
| **02 — Connect** | Agents send encouragement, support, or appreciation — identity fully hidden |
| **03 — Guess** | Everyone tries to crack the case: who's been quietly looking out for them? |
| **04 — Reveal** | The organizer runs one command, all identities unlock. Cue surprised faces and new friendships |

---

## ✨ Features

| Feature | Details |
|---------|---------|
| 🎭 **Fully Anonymous** | Agents appear as `??? (Anonymous)` until the final reveal |
| 🔐 **End-to-End Encrypted** | Messages are encrypted in the browser via the Web Crypto API — the server never sees plaintext |
| ⚡ **Real-Time** | Live typing indicators and instant delivery via Socket.IO |
| 🧮 **Smart Assignments** | Hamiltonian Cycle algorithm guarantees no mutual links (A→B never means B→A) |
| 📱 **Mobile-First** | Fully responsive — works great on phones during in-office events |
| 🎮 **Admin CLI Controls** | One-command event start and reveal — no UI needed |
| 🔁 **Multi-Round Support** | Instantly reset and run another round right after reveal |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 18+ |
| **Framework** | Express 5 |
| **Real-time** | Socket.IO 4 |
| **Database** | MongoDB via Mongoose |
| **Auth** | JWT + bcryptjs |
| **Encryption** | Web Crypto API (browser-side E2EE) |
| **Security** | Helmet, CORS, express-rate-limit |
| **Frontend** | Vanilla HTML, CSS, JavaScript |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **MongoDB** — local instance or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (free tier works great)

### 1. Clone & Install

```bash
git clone https://github.com/DeepanBiswas07/Appreciation-Agent.git
cd Appreciation-Agent
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

SERVER_URL=http://localhost:3000
CLIENT_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000

MONGO_URI=mongodb://localhost:27017/secret-appreciation
JWT_SECRET=replace_with_a_long_random_string_at_least_64_characters_long
TRUST_PROXY=0
```

> **Tip:** Generate a strong `JWT_SECRET` with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```

### 3. Start the Server

```bash
npm start
```

Open your browser and navigate to `http://localhost:3000`.  
Share this URL with your team on the same network.

---

## 🎮 Running an Event

### Step 1 — Team Registers
Share the URL with your team. Everyone signs up with their name and a password. They land on the **Waiting Room** and can see who else has joined in real-time.

### Step 2 — Start the Round

Once everyone is ready, the organizer runs **one command**:

```bash
npm run start-event
```

The **Hamiltonian Cycle** kicks in — every participant is instantly paired with a unique secret target. All connected clients update live. The game is on. 🎉

### Step 3 — Agents Operate

Each participant sees:
- 🎭 **Their secret target** — the person they must appreciate anonymously
- 👀 **That someone is watching over them** — their agent is anonymous until reveal

Agents send appreciation messages through the encrypted chat. The recipient has no idea who it's from.

### Step 4 — Reveal & Reset

When the event ends, the organizer runs:

```bash
npm run list-agents
```

The full assignment table is printed, all identities unlock, and everyone is returned to the Waiting Room — ready for the next round.

```
🎭 Secret Appreciation Agent — Final Reveal
════════════════════════════════════════════════════════════════
 Employee        │ Their Secret Appreciation Agent was
─────────────────────────────────────────────────────────────────
 Alice           │ Marcus
 Marcus          │ Jordan
 Jordan          │ Priya
 Priya           │ Alex
 Alex            │ Alice
════════════════════════════════════════════════════════════════

♻️  Game has been reset. Run "npm run start-event" to start a new round!
```

---

## 📁 Project Structure

```
Appreciation-Agent/
├── public/
│   ├── index.html          # Single-page app shell
│   ├── app.js              # Client-side logic & socket event handlers
│   └── style.css           # Dark neon-green theme
├── server/
│   ├── server.js           # Express app entry point
│   ├── assignAgents.js     # CLI: Hamiltonian cycle assignment
│   ├── listAgents.js       # CLI: reveal assignments & reset game
│   ├── models/             # Mongoose schemas (User, Message)
│   ├── routes/             # REST API routes (auth, user)
│   └── sockets/            # Socket.IO real-time event handlers
├── .env.example            # Environment variable template
├── package.json
└── README.md
```

---

## 🔒 Security

- **E2EE Messaging** — All messages are encrypted client-side before transmission; the server only stores and relays ciphertext
- **Password Hashing** — bcryptjs with salt rounds
- **Stateless Auth** — JWT-based sessions, no server-side session storage
- **Rate Limiting** — API endpoints are rate-limited to prevent abuse
- **Secure Headers** — Helmet.js sets appropriate HTTP security headers
- **In production:** Always use HTTPS and a strong, randomly generated `JWT_SECRET`

---

## 📈 Scaling

| Team Size | Recommendation |
|-----------|---------------|
| **< 50** | Works perfectly out of the box |
| **50–200** | Migrate the `onlineUsers` in-memory map to **Redis** |
| **200+** | Add a Redis adapter for Socket.IO to support horizontal scaling |

---

## 📜 License

MIT — built for office fun. Fork it, run it, make your team smile. 🎉
