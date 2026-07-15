"use strict";

const { Server }             = require("socket.io");
const { socketAuthMiddleware } = require("../middleware/socketAuth");
const { addUser, removeUser, getUser, getAllUsers } = require("../store/onlineUsers");
const { createMessage, findMessage, getMessages, markMessageRead, getSessionId } = require("../services/message");

function isValidEncryptedPayload({ encryptedmessage, nonce }) {
  return (
    typeof encryptedmessage === "string" && encryptedmessage.length > 0 &&
    typeof nonce === "string" && nonce.length > 0
  );
}

function formatMessage(msg) {
  return {
    messageId:        msg.messageId,
    sessionId:        msg.sessionId,
    senderId:         msg.senderId,
    receiverId:       msg.receiverId,
    encryptedmessage: msg.encryptedmessage,
    nonce:            msg.nonce,
    header:           msg.header,
    version:          msg.version,
    clientId:         msg.clientId,
    status:           msg.status,
    createdAt:        msg.createdAt,
    sentAt:           msg.sentAt,
    deliveredAt:      msg.deliveredAt,
    readAt:           msg.readAt,
  };
}

function buildCorsOrigin() {
  const raw = process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || "";
  if (!raw || raw.trim() === "*") return "*";
  const origins = raw.split(",").map((o) => o.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
}

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin:      buildCorsOrigin(),
      methods:     ["GET", "POST"],
      credentials: true,
    },
    maxHttpBufferSize: 2e6,
  });

  io.use(socketAuthMiddleware);

  // Broadcast current online user list to everyone
  function broadcastOnlineUsers() {
    const users = getAllUsers();
    const userList = Object.entries(users).map(([uid, u]) => ({
      userId: uid,
      name:   u.name,
      online: true,
    }));
    io.emit("user_list", userList);
  }

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    const name   = socket.data.name;
    console.log(`🟢 Connected: ${socket.id} → ${userId}`);

    // Join a room named after userId — ALL sockets for this user get messages
    socket.join(userId);
    addUser(userId, socket.id, name);
    broadcastOnlineUsers();

    // ── TYPING ──────────────────────────────────────────────────────
    socket.on("typing_start", ({ to }) => {
      if (!to) return;
      io.to(to).emit("typing", { from: userId });
    });

    socket.on("typing_stop", ({ to }) => {
      if (!to) return;
      io.to(to).emit("typing_stop", { from: userId });
    });

    // ── SEND MESSAGE ─────────────────────────────────────────────────
    socket.on("send_message", async (payload, ack) => {
      try {
        const fromId = socket.data.userId;
        if (!fromId) { ack && ack({ error: "Unauthorized" }); return; }

        const raw            = payload && typeof payload === "object" ? payload : {};
        const toId           = String(raw.to               || "").trim().toLowerCase();
        const safeEncMsg     = String(raw.encryptedmessage || "").trim();
        const safeNonce      = String(raw.nonce             || "").trim();
        const safeHeader     = raw.header ? String(raw.header).trim() : "";
        const safeClientId   = String(raw.clientId || Date.now().toString()).slice(0, 128);

        if (!toId)           { ack && ack({ error: "Invalid receiver" }); return; }
        if (fromId === toId) { ack && ack({ error: "Cannot message yourself" }); return; }

        if (!isValidEncryptedPayload({ encryptedmessage: safeEncMsg, nonce: safeNonce })) {
          ack && ack({ error: "Invalid encrypted payload" }); return;
        }

        const convId = getSessionId(fromId, toId);

        let msg = await findMessage(fromId, safeClientId);
        if (!msg) {
          msg = await createMessage({
            sessionId:        convId,
            senderId:         fromId,
            receiverId:       toId,
            encryptedmessage: safeEncMsg,
            nonce:            safeNonce,
            header:           safeHeader,
            clientId:         safeClientId,
            status:           "sent",
            sentAt:           new Date(),
          });
        }

        // Deliver to ALL sockets of the recipient via their room
        const recipientOnline = getUser(toId);
        if (recipientOnline) {
          io.to(toId).emit("receive_message", formatMessage(msg));
          msg.status      = "delivered";
          msg.deliveredAt = new Date();
          await msg.save();
          // Notify sender of delivery on ALL their sockets
          io.to(fromId).emit("message_status", {
            messageId: msg.messageId,
            clientId:  safeClientId,
            status:    "delivered",
          });
        }

        ack && ack(formatMessage(msg));
      } catch (err) {
        console.error("send_message error:", err);
        ack && ack({ error: "Server error" });
      }
    });

    // ── LOAD MESSAGES ────────────────────────────────────────────────
    socket.on("load_messages", async ({ with: withUserId }) => {
      try {
        const convId = getSessionId(userId, withUserId);
        const msgs = await getMessages(convId);
        socket.emit("chat_history", msgs.map(formatMessage));
      } catch (err) {
        console.error("load_messages error:", err);
        socket.emit("chat_history", []);
      }
    });

    // ── MESSAGE READ ─────────────────────────────────────────────────
    socket.on("message_read", async ({ messageId }) => {
      try {
        const msg = await markMessageRead(messageId, userId);
        if (!msg) return;
        // Notify sender on all their sockets
        io.to(msg.senderId).emit("message_status", {
          messageId,
          clientId: msg.clientId,
          status:   "read",
        });
      } catch (err) {
        console.error("message_read error:", err);
      }
    });

    // ── DISCONNECT ───────────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`🔴 Disconnected: ${socket.id} → ${userId}`);
      // Only mark offline when NO sockets remain in this user's room
      const room = io.sockets.adapter.rooms.get(userId);
      const remainingSockets = room ? room.size : 0;
      if (remainingSockets === 0) {
        removeUser(userId);
        broadcastOnlineUsers();
      }
    });
  });

  return io;
}

module.exports = { initSocket };
