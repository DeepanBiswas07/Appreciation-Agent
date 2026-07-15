"use strict";

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    userId:       { type: String, required: true, unique: true, lowercase: true, trim: true },
    name:         { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    publicKey:       { type: String, default: null },
    wrappedPrivateKey: { type: String, default: null }, // ECDH private key wrapped with password-derived AES key
    // Agent assignment — set by assignAgents.js
    myAgentId:    { type: String, default: null },   // who is MY secret agent (name hidden from me)
    iAmAgentFor:  { type: String, default: null },   // who I am the secret agent for (name shown to me)
    eventStarted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model("User", userSchema);
