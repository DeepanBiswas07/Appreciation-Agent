"use strict";

const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const messageSchema = new mongoose.Schema(
  {
    messageId:        { type: String, default: uuidv4, unique: true },
    sessionId:        { type: String, required: true, index: true },
    senderId:         { type: String, required: true },
    receiverId:       { type: String, required: true },
    encryptedmessage: { type: String, required: true },
    nonce:            { type: String, required: true },
    header:           { type: String, default: "" },
    version:          { type: Number, default: 1 },
    clientId:         { type: String, default: "" },
    status:           { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
    sentAt:           { type: Date, default: Date.now },
    deliveredAt:      { type: Date },
    readAt:           { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
