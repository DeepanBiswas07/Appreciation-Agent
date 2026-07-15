"use strict";

/**
 * listAgents.js — Organizer reveal + game reset.
 * Usage:  npm run list-agents
 *         node server/listAgents.js
 *
 * This command:
 *  1. Prints the full assignment table (who was whose secret agent)
 *  2. Clears all assignments from the database
 *  3. Deletes all chat messages
 *  4. Resets everyone to the waiting screen, ready for a fresh round
 */

require("dotenv").config();

const mongoose = require("mongoose");
const User     = require("./models/User");
const Message  = require("./models/Message");

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI not set. Check your .env file.");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);

    const users = await User.find({}).lean();

    if (users.length === 0) {
      console.log("⚠️  No users registered yet.");
      await mongoose.disconnect();
      process.exit(0);
    }

    const assigned = users.filter((u) => u.myAgentId);

    if (assigned.length === 0) {
      console.log("⚠️  Event hasn't started yet — no assignments found.");
      console.log("   Run \"npm run start-event\" first.");
      await mongoose.disconnect();
      process.exit(0);
    }

    const userMap = Object.fromEntries(users.map((u) => [u.userId, u.name]));

    // ── Print the full reveal table ───────────────────────────────────────
    console.log("\n🎭 Secret Appreciation Agent — Final Reveal");
    console.log("════════════════════════════════════════════════════════════════");
    console.log(` ${"Employee".padEnd(22)} │ ${"Their Secret Appreciation Agent was"}`);
    console.log("────────────────────────────────────────────────────────────────");

    assigned.forEach((u) => {
      const agentName = userMap[u.myAgentId] || u.myAgentId;
      console.log(` ${u.name.padEnd(22)} │ ${agentName}`);
    });

    console.log("════════════════════════════════════════════════════════════════\n");

    // ── Reset all assignments ─────────────────────────────────────────────
    await User.updateMany(
      {},
      { $set: { myAgentId: null, iAmAgentFor: null } }
    );

    // ── Delete all messages ───────────────────────────────────────────────
    const { deletedCount } = await Message.deleteMany({});

    console.log("♻️  Game has been reset:");
    console.log(`   • All agent assignments cleared`);
    console.log(`   • ${deletedCount} message(s) deleted`);
    console.log("   • Everyone is back on the waiting screen\n");
    console.log("   Run \"npm run start-event\" to start a new round!\n");

    try {
      await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/admin/reset`, { method: "POST" });
    } catch (e) {
      console.log("⚠️  Could not trigger live reset to clients (is server running?)");
    }

    await mongoose.disconnect();
    setTimeout(() => process.exit(0), 100);
  } catch (err) {
    console.error("❌ Error:", err.message);
    await mongoose.disconnect();
    setTimeout(() => process.exit(1), 100);
  }
}

main();
