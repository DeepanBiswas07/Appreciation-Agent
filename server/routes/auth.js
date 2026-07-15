"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

// POST /auth/register  (mounted at /auth in server.js, so path here is /register)
router.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const name = String(username || "").trim();
    const pass = String(password || "").trim();

    if (!name || !pass) {
      return res.status(400).json({ success: false, error: "username and password are required" });
    }
    if (name.length < 2 || name.length > 32) {
      return res.status(400).json({ success: false, error: "username must be 2–32 characters" });
    }
    if (pass.length < 4) {
      return res.status(400).json({ success: false, error: "password must be at least 4 characters" });
    }

    const userId = name.toLowerCase().replace(/\s+/g, "_");
    const existing = await User.findOne({ userId });
    if (existing) {
      return res.status(409).json({ success: false, error: "Username already taken" });
    }

    const passwordHash = await bcrypt.hash(pass, 10);
    const user = new User({ userId, name, passwordHash });
    await user.save();

    const token = jwt.sign(
      { userId, name },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "24h" }
    );

    return res.status(201).json({ success: true, token, userId, name });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /auth/login  (path here is /login)
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const name = String(username || "").trim();
    const pass = String(password || "").trim();

    if (!name || !pass) {
      return res.status(400).json({ success: false, error: "username and password are required" });
    }

    const userId = name.toLowerCase().replace(/\s+/g, "_");
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }

    const ok = await user.comparePassword(pass);
    if (!ok) {
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }

    const token = jwt.sign(
      { userId, name: user.name },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "24h" }
    );

    return res.json({ success: true, token, userId, name: user.name });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
