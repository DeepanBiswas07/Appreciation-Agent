"use strict";

const express = require("express");
const User = require("../models/User");
const { apiAuthMiddleware } = require("../middleware/apiAuth");

const router = express.Router();

// GET /api/me — get current user's event info (assignments)
router.get("/me", apiAuthMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId }).lean();
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    // If event hasn't started, just return basic info
    if (!user.myAgentId) {
      return res.json({
        success: true,
        eventStarted: false,
        userId: user.userId,
        name: user.name,
      });
    }

    // Fetch the person the user is an agent for
    const targetUser = user.iAmAgentFor
      ? await User.findOne({ userId: user.iAmAgentFor }).lean()
      : null;

    return res.json({
      success: true,
      eventStarted: true,
      userId: user.userId,
      name: user.name,
      // Agent info — name is HIDDEN (agent is anonymous)
      myAgent: {
        userId: user.myAgentId,
        // name intentionally omitted — revealed at end of event
      },
      // Target info — name is SHOWN (so you can send appreciation)
      iAmAgentFor: targetUser
        ? { userId: targetUser.userId, name: targetUser.name }
        : null,
    });
  } catch (err) {
    console.error("GET /me error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/users — list all registered users (for the organizer or UI)
router.get("/users", apiAuthMiddleware, async (req, res) => {
  try {
    const users = await User.find({}).select("userId name createdAt").lean();
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/keys — save public key + wrapped private key for E2EE
router.post("/keys", apiAuthMiddleware, async (req, res) => {
  try {
    const { publicKey, wrappedPrivateKey } = req.body || {};
    if (!publicKey) return res.status(400).json({ success: false, error: "publicKey required" });
    const update = { publicKey };
    if (wrappedPrivateKey) update.wrappedPrivateKey = wrappedPrivateKey;
    await User.updateOne({ userId: req.user.userId }, update);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/mykey — get current user's own wrapped private key (to restore key pair on login)
router.get("/mykey", apiAuthMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId }).select("publicKey wrappedPrivateKey").lean();
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    return res.json({ success: true, publicKey: user.publicKey, wrappedPrivateKey: user.wrappedPrivateKey });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/keys/:userId — get public key for a user (public, no auth needed on this one)
router.get("/keys/:userId", async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId }).select("publicKey").lean();
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    return res.json({ success: true, publicKey: user.publicKey });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
