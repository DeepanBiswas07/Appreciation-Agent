"use strict";

const Message = require("../models/Message");
const { v4: uuidv4 } = require("uuid");

function getSessionId(u1, u2) {
  return [u1, u2].sort().join("_");
}

async function createMessage(data) {
  const msg = new Message({
    messageId:        uuidv4(),
    sessionId:        data.sessionId,
    senderId:         data.senderId,
    receiverId:       data.receiverId,
    encryptedmessage: data.encryptedmessage,
    nonce:            data.nonce,
    header:           data.header || "",
    clientId:         data.clientId || "",
    status:           data.status || "sent",
    sentAt:           data.sentAt || new Date(),
  });
  await msg.save();
  return msg;
}

async function findMessage(senderId, clientId) {
  if (!clientId) return null;
  return Message.findOne({ senderId, clientId });
}

async function getMessages(sessionId) {
  return Message.find({ sessionId }).sort({ sentAt: 1 }).lean();
}

async function markMessageRead(messageId, readerId) {
  const msg = await Message.findOne({ messageId, receiverId: readerId });
  if (!msg || msg.status === "read") return msg;
  msg.status  = "read";
  msg.readAt  = new Date();
  await msg.save();
  return msg;
}

module.exports = { createMessage, findMessage, getMessages, markMessageRead, getSessionId };
