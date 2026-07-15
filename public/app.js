/* ═══════════════════════════════════════════════════════════════
   Secret Appreciation Agent — app.js
   End-to-End Encrypted real-time messaging
   E2EE uses Web Crypto API: ECDH key exchange + AES-GCM encryption
   ═══════════════════════════════════════════════════════════════ */

"use strict";

// ── State ────────────────────────────────────────────────────────
const state = {
  token:          null,
  userId:         null,
  name:           null,
  // event data
  eventStarted:   false,
  myAgentId:      null,
  targetUser:     null,        // { userId, name }
  // chat
  currentChatWith: null,       // userId
  currentChatIsAgent: false,
  // E2EE
  myKeyPair:      null,        // { privateKey, publicKey }
  peerPublicKeys: {},          // { userId -> CryptoKey }
  sharedSecrets:  {},          // { userId -> CryptoKey (AES-GCM) }
};

let socket      = null;
let typingTimer = null;
let isTyping    = false;

// ── Server URL ───────────────────────────────────────────────────
function getServerUrl() {
  return (window.ENV && window.ENV.SERVER_URL) || window.location.origin;
}

// ══════════════════════════════════════════════════════════════════
//  E2EE — Web Crypto helpers
// ══════════════════════════════════════════════════════════════════

async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,  // extractable so we can export to localStorage
    ["deriveKey"]
  );
}

// ── Password-based key derivation (PBKDF2 → AES-GCM wrapping key) ──
// The password itself never leaves the browser.
// The ECDH private key is wrapped (encrypted) with the password-derived AES key
// and stored on the server — so any device + correct password can restore it.
async function deriveWrappingKey(password, userId) {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name:       "PBKDF2",
      salt:       enc.encode("saa-salt:" + userId), // stable per-user salt
      iterations: 200000,
      hash:       "SHA-256",
    },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

// Wrap ECDH private key with the password-derived AES key
async function wrapPrivateKey(privateKey, wrappingKey) {
  const iv      = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey("pkcs8", privateKey, wrappingKey, { name: "AES-GCM", iv });
  // Prepend IV so we can recover it on unwrap
  const out = new Uint8Array(12 + wrapped.byteLength);
  out.set(iv);
  out.set(new Uint8Array(wrapped), 12);
  return btoa(String.fromCharCode(...out));
}

// Unwrap ECDH private key using the password-derived AES key
async function unwrapPrivateKey(b64, wrappingKey) {
  const bytes   = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv      = bytes.slice(0, 12);
  const wrapped = bytes.slice(12);
  return crypto.subtle.unwrapKey(
    "pkcs8",
    wrapped,
    wrappingKey,
    { name: "AES-GCM", iv },
    { name: "ECDH", namedCurve: "P-256" },
    true,          // extractable (needed to re-derive public key)
    ["deriveKey"]
  );
}

// Re-derive public key from the private key by temporarily exporting JWK
// Web Crypto doesn't expose "get public key from private key" directly,
// so we generate a throwaway pair and swap in our private key scalar.
async function publicKeyFromPrivateJwk(privateKey) {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  // d is the private scalar; x,y are the public point — they travel together in JWK
  const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, key_ops: [] };
  return crypto.subtle.importKey("jwk", pubJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

async function exportPublicKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importPublicKey(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

async function deriveSharedKey(myPrivate, theirPublic) {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: theirPublic },
    myPrivate,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptMessage(sharedKey, plaintext) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data  = new TextEncoder().encode(plaintext);
  const ct    = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, sharedKey, data);
  return {
    encryptedmessage: btoa(String.fromCharCode(...new Uint8Array(ct))),
    nonce: btoa(String.fromCharCode(...nonce)),
  };
}

async function decryptMessage(sharedKey, encryptedmessage, nonce) {
  try {
    const ct    = Uint8Array.from(atob(encryptedmessage), (c) => c.charCodeAt(0));
    const iv    = Uint8Array.from(atob(nonce),             (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, ct);
    return new TextDecoder().decode(plain);
  } catch {
    return "🔒 [Encrypted message — key not available]";
  }
}

async function getOrDeriveSharedKey(peerId) {
  if (state.sharedSecrets[peerId]) return state.sharedSecrets[peerId];

  let peerKey = state.peerPublicKeys[peerId];
  if (!peerKey) {
    // Fetch from server
    const res = await apiFetch(`/api/keys/${peerId}`, "GET");
    if (!res.ok || !res.data.publicKey) return null;
    peerKey = await importPublicKey(res.data.publicKey);
    state.peerPublicKeys[peerId] = peerKey;
  }

  const sharedKey = await deriveSharedKey(state.myKeyPair.privateKey, peerKey);
  state.sharedSecrets[peerId] = sharedKey;
  return sharedKey;
}

// ══════════════════════════════════════════════════════════════════
//  API helpers
// ══════════════════════════════════════════════════════════════════

async function apiFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (state.token) opts.headers["Authorization"] = `Bearer ${state.token}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(getServerUrl() + path, opts);
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

// ══════════════════════════════════════════════════════════════════
//  Auth
// ══════════════════════════════════════════════════════════════════

function switchTab(tab) {
  const isLogin = tab === "login";
  document.getElementById("tab-login").classList.toggle("active", isLogin);
  document.getElementById("tab-register").classList.toggle("active", !isLogin);
  document.getElementById("login-form").classList.toggle("active", isLogin);
  document.getElementById("register-form").classList.toggle("active", !isLogin);
  document.getElementById("tab-indicator").classList.toggle("right", !isLogin);
  document.getElementById("login-error").textContent    = "";
  document.getElementById("register-error").textContent = "";
}

function togglePass(inputId, btn) {
  const inp = document.getElementById(inputId);
  inp.type = inp.type === "password" ? "text" : "password";
  btn.textContent = inp.type === "password" ? "👁" : "🙈";
}

function setLoading(btnId, loading) {
  const btn    = document.getElementById(btnId);
  const text   = btn.querySelector(".btn-text");
  const loader = btn.querySelector(".btn-loader");
  btn.disabled = loading;
  text.classList.toggle("hidden", loading);
  loader.classList.toggle("hidden", !loading);
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl    = document.getElementById("login-error");
  errEl.textContent = "";

  if (!window.crypto || !window.crypto.subtle) {
    errEl.textContent = "Error: E2EE requires a secure context (HTTPS or localhost). You cannot use an IP address over HTTP.";
    return;
  }

  setLoading("login-btn", true);
  const res = await apiFetch("/auth/login", "POST", { username, password });
  setLoading("login-btn", false);

  if (!res.ok) {
    errEl.textContent = res.data.error || "Login failed";
    return;
  }

  await onAuthSuccess(res.data.token, res.data.userId, res.data.name, password);
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const errEl    = document.getElementById("register-error");
  errEl.textContent = "";

  if (!window.crypto || !window.crypto.subtle) {
    errEl.textContent = "Error: E2EE requires a secure context (HTTPS or localhost). You cannot use an IP address over HTTP.";
    return;
  }

  setLoading("register-btn", true);
  const res = await apiFetch("/auth/register", "POST", { username, password });
  setLoading("register-btn", false);

  if (!res.ok) {
    errEl.textContent = res.data.error || "Registration failed";
    return;
  }

  await onAuthSuccess(res.data.token, res.data.userId, res.data.name, password);
}

async function onAuthSuccess(token, userId, name, password) {
  state.token  = token;
  state.userId = userId;
  state.name   = name;

  // Derive the AES wrapping key from the user's password (never leaves the browser)
  const wrappingKey = await deriveWrappingKey(password, userId);

  // Try to restore the key pair from the server-stored wrapped private key
  const stored = await apiFetch("/api/mykey");

  if (stored.ok && stored.data.wrappedPrivateKey) {
    // ── Existing user on any device: unwrap private key using their password ──
    try {
      const privateKey = await unwrapPrivateKey(stored.data.wrappedPrivateKey, wrappingKey);
      const publicKey  = await publicKeyFromPrivateJwk(privateKey);
      state.myKeyPair  = { privateKey, publicKey };
      // Always re-upload the public key so peers always get the current value
      const pubB64 = await exportPublicKey(publicKey);
      await apiFetch("/api/keys", "POST", { publicKey: pubB64, wrappedPrivateKey: stored.data.wrappedPrivateKey });
    } catch {
      // Wrong password or corrupt data — shouldn’t happen but regenerate gracefully
      state.myKeyPair = await generateAndStoreKeyPair(userId, wrappingKey);
    }
  } else {
    // ── First login: generate fresh ECDH pair, wrap with password, save to server ──
    state.myKeyPair = await generateAndStoreKeyPair(userId, wrappingKey);
  }

  await refreshEventState();
}

async function generateAndStoreKeyPair(userId, wrappingKey) {
  const keyPair         = await generateKeyPair();
  const wrappedPrivKey  = await wrapPrivateKey(keyPair.privateKey, wrappingKey);
  const pubB64          = await exportPublicKey(keyPair.publicKey);
  await apiFetch("/api/keys", "POST", { publicKey: pubB64, wrappedPrivateKey: wrappedPrivKey });
  return keyPair;
}

async function refreshEventState() {
  const res = await apiFetch("/api/me");
  if (!res.ok) return;

  const d = res.data;
  state.eventStarted = d.eventStarted;
  state.myAgentId    = d.myAgent?.userId || null;
  state.targetUser   = d.iAmAgentFor || null;

  if (!d.eventStarted) {
    showWaiting();
    pollEventState();
  } else {
    showApp();
    connectSocket();
  }
}

function pollEventState() {
  if (state.eventStarted || window.pollTimer) return;
  
  // Poll every 3 seconds while waiting for event to start
  window.pollTimer = setTimeout(async () => {
    window.pollTimer = null;
    if (state.eventStarted) return;
    
    await refreshEventState();
    
    if (!state.eventStarted) {
      pollEventState();
    }
  }, 3000);
}

function logout() {
  if (socket) { socket.disconnect(); socket = null; }
  Object.assign(state, {
    token: null, userId: null, name: null,
    eventStarted: false, myAgentId: null, targetUser: null,
    currentChatWith: null, myKeyPair: null,
    peerPublicKeys: {}, sharedSecrets: {},
  });
  showScreen("auth-screen");
  switchTab("login");
}

// ══════════════════════════════════════════════════════════════════
//  Screen management
// ══════════════════════════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

async function showWaiting() {
  showScreen("waiting-screen");
  document.getElementById("waiting-name").textContent = state.name;

  // Show registered users list
  const res = await apiFetch("/api/users");
  const list = document.getElementById("registered-users-list");
  list.innerHTML = "";
  if (res.ok) {
    res.data.users.forEach((u) => {
      const li = document.createElement("li");
      li.textContent = u.name;
      list.appendChild(li);
    });
  }
}

function showApp() {
  showScreen("app-screen");

  // Sidebar: username & avatar
  document.getElementById("sidebar-username").textContent = state.name;
  document.getElementById("sidebar-avatar").textContent   = state.name[0].toUpperCase();

  // Target assignment
  const targetName = state.targetUser?.name || "—";
  document.getElementById("target-name").textContent = targetName;
  document.getElementById("chat-with-target-btn").disabled = !state.targetUser;

  // Agent assignment (name stays hidden)
  document.getElementById("chat-with-agent-btn").disabled = !state.myAgentId;
}

// ══════════════════════════════════════════════════════════════════
//  Socket.IO
// ══════════════════════════════════════════════════════════════════

function connectSocket() {
  if (socket && socket.connected) return;

  socket = io(getServerUrl(), {
    auth: { token: state.token },
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => {
    console.log("🟢 Socket connected");
  });

  socket.on("user_list", (users) => {
    // Clear cached shared secrets — a peer may have rotated their key pair
    state.peerPublicKeys = {};
    state.sharedSecrets  = {};

    // Update status dots
    const isOnline = (uid) => users.some(u => u.userId === uid && u.online);

    const agentDot = document.getElementById("agent-status");
    if (agentDot && state.myAgentId) {
      const online = isOnline(state.myAgentId);
      agentDot.className = `status-dot ${online ? 'online' : 'offline'}`;
      agentDot.title = online ? "Online" : "Offline";
    }

    const targetDot = document.getElementById("target-status");
    if (targetDot && state.targetUser) {
      const online = isOnline(state.targetUser.userId);
      targetDot.className = `status-dot ${online ? 'online' : 'offline'}`;
      targetDot.title = online ? "Online" : "Offline";
    }
  });

  socket.on("receive_message", async (msg) => {
    if (msg.senderId === state.currentChatWith) {
      await appendMessage(msg, false);
      socket.emit("message_read", { messageId: msg.messageId });
    } else {
      showNotification(msg.senderId);
    }
  });

  socket.on("message_status", ({ messageId, status }) => {
    const el = document.querySelector(`[data-msg-id="${messageId}"] .bubble-status`);
    if (el) {
      el.textContent = status === "read" ? "✓✓ Read" : status === "delivered" ? "✓✓" : "✓";
      el.className   = `bubble-status ${status}`;
    }
  });

  socket.on("event_reset", async () => {
    socket.disconnect();
    socket = null;
    state.currentChatWith = null;
    document.getElementById("messages-container").innerHTML = '<div class="day-divider"><span>Today</span></div>';
    document.getElementById("chat-panel").classList.add("hidden");
    document.getElementById("no-chat-placeholder").classList.remove("hidden");
    document.getElementById("no-chat-placeholder").style.display = ""; // clear any inline styles just in case
    closeChat(); // Ensures mobile layout resets to sidebar
    await refreshEventState();
  });

  socket.on("typing", ({ from }) => {
    if (from === state.currentChatWith) showTyping(true);
  });

  socket.on("typing_stop", ({ from }) => {
    if (from === state.currentChatWith) showTyping(false);
  });

  socket.on("disconnect", () => console.log("🔴 Socket disconnected"));
  socket.on("connect_error", (err) => console.error("Socket error:", err.message));
}

// ══════════════════════════════════════════════════════════════════
//  Chat
// ══════════════════════════════════════════════════════════════════

function openChatWithAgent() {
  if (!state.myAgentId) return;
  clearNotification(true);
  openChat(state.myAgentId, true);
}

function openChatWithTarget() {
  if (!state.targetUser) return;
  clearNotification(false);
  openChat(state.targetUser.userId, false);
}

function showNotification(senderId) {
  if (senderId === state.myAgentId) {
    document.getElementById("chat-with-agent-btn").classList.add("has-unread");
  } else if (state.targetUser && senderId === state.targetUser.userId) {
    document.getElementById("chat-with-target-btn").classList.add("has-unread");
  }
}

function clearNotification(isAgent) {
  if (isAgent) {
    document.getElementById("chat-with-agent-btn").classList.remove("has-unread");
  } else {
    document.getElementById("chat-with-target-btn").classList.remove("has-unread");
  }
}

async function openChat(peerId, isAgent) {
  state.currentChatWith    = peerId;
  state.currentChatIsAgent = isAgent;

  // Show chat panel
  document.getElementById("no-chat-placeholder").classList.add("hidden");
  const chatPanel = document.getElementById("chat-panel");
  chatPanel.classList.remove("hidden");
  
  // Mobile layout switch
  document.getElementById("app-screen").classList.add("chat-open");

  // Set header
  const displayName = isAgent ? "??? (Your Secret Appreciation Agent)" : state.targetUser.name;
  document.getElementById("chat-peer-name").textContent = displayName;

  document.getElementById("chat-avatar").textContent    = isAgent ? "?" : state.targetUser.name[0].toUpperCase();

  // Clear messages
  const container = document.getElementById("messages-container");
  container.innerHTML = `<div class="day-divider"><span>Today</span></div>`;

  // Load history
  socket.emit("load_messages", { with: peerId });
  socket.once("chat_history", async (msgs) => {
    for (const msg of msgs) {
      await appendMessage(msg, msg.senderId === state.userId);
    }
    scrollToBottom();
  });

  // Focus input
  document.getElementById("message-input").focus();
}

function closeChat() {
  document.getElementById("app-screen").classList.remove("chat-open");
}

async function appendMessage(msg, isSent) {
  const container = document.getElementById("messages-container");

  // Decrypt
  const peerId    = isSent ? msg.receiverId : msg.senderId;
  const sharedKey = await getOrDeriveSharedKey(peerId);
  let text;
  if (sharedKey) {
    text = await decryptMessage(sharedKey, msg.encryptedmessage, msg.nonce);
  } else {
    text = "🔒 [Encrypted]";
  }

  const div = document.createElement("div");
  div.className = `message-bubble ${isSent ? "sent" : "received"}`;
  div.setAttribute("data-msg-id", msg.messageId);

  const time = new Date(msg.sentAt || msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const statusText = isSent
    ? (msg.status === "read" ? "✓✓ Read" : msg.status === "delivered" ? "✓✓" : "✓")
    : "";

  div.innerHTML = `
    <div class="bubble-content">${escapeHtml(text)}</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <span class="bubble-time">${time}</span>
      ${isSent ? `<span class="bubble-status ${msg.status}">${statusText}</span>` : ""}
    </div>
  `;

  container.appendChild(div);
  scrollToBottom();
}

async function sendMessage() {
  const input    = document.getElementById("message-input");
  const text     = input.value.trim();
  const peerId   = state.currentChatWith;

  if (!text || !peerId || !socket) return;

  const sharedKey = await getOrDeriveSharedKey(peerId);
  if (!sharedKey) {
    alert("Cannot encrypt message — peer public key not found.");
    return;
  }

  const { encryptedmessage, nonce } = await encryptMessage(sharedKey, text);
  const clientId = `${state.userId}_${Date.now()}`;

  input.value = "";
  autoResize(input);

  socket.emit("send_message", {
    to: peerId,
    encryptedmessage,
    nonce,
    header: "",
    clientId,
  }, async (msg) => {
    if (msg && !msg.error) {
      await appendMessage({ ...msg, encryptedmessage, nonce }, true);
    }
  });

  stopTyping();
}

function handleInputKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function handleTyping() {
  autoResize(document.getElementById("message-input"));
  if (!isTyping && state.currentChatWith) {
    isTyping = true;
    socket && socket.emit("typing_start", { to: state.currentChatWith });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  if (isTyping) {
    isTyping = false;
    socket && socket.emit("typing_stop", { to: state.currentChatWith });
  }
  clearTimeout(typingTimer);
}

function showTyping(show) {
  document.getElementById("typing-indicator").classList.toggle("hidden", !show);
}

function scrollToBottom() {
  const c = document.getElementById("messages-container");
  c.scrollTop = c.scrollHeight;
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}



// ── Utilities ────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  showScreen("auth-screen");
});
