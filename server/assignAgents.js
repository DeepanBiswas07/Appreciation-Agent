"use strict";

/**
 * assignAgents.js — run ONCE after everyone has registered.
 * Usage:  npm run start-event
 *         node server/assignAgents.js
 *
 * Rules:
 *  - Every person gets exactly one Secret Agent (someone else assigned to them)
 *  - Every person is also the Secret Agent for exactly one other person
 *  - No one is their own agent
 * This is implemented as a random derangement (permutation with no fixed points).
 */

require("dotenv").config();

const mongoose = require("mongoose");
const User     = require("./models/User");

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Creates a single continuous cycle among all participants.
 * This guarantees no two people have each other (no A->B and B->A)
 * unless there are exactly 2 participants.
 */
function createCycle(arr) {
  if (arr.length < 2) {
    throw new Error("Need at least 2 participants to assign agents.");
  }
  const shuffled = shuffle([...arr]);
  const agents = new Array(arr.length);
  
  for (let i = 0; i < shuffled.length; i++) {
    const target = shuffled[i];
    const agent = shuffled[(i + 1) % shuffled.length];
    agents[arr.indexOf(target)] = agent;
  }
  
  return agents;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI not set. Check your .env file.");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const users = await User.find({}).lean();

    if (users.length < 2) {
      console.error(`❌ Only ${users.length} user(s) registered. Need at least 2 participants.`);
      await mongoose.disconnect();
      process.exit(1);
    }

    const ids      = users.map((u) => u.userId);
    const agents   = createCycle(ids); // agents[i] is the agent assigned to ids[i]

    const updates = ids.map((targetId, i) => {
      const agentId = agents[i];
      return User.updateOne(
        { userId: targetId },
        { myAgentId: agentId }
      );
    });

    // Also set iAmAgentFor: agent agents[i] is the secret agent for ids[i],
    // meaning user `agents[i]` has iAmAgentFor = ids[i]
    const reverseUpdates = ids.map((targetId, i) => {
      const agentId = agents[i];
      return User.updateOne(
        { userId: agentId },
        { iAmAgentFor: targetId }
      );
    });

    await Promise.all([...updates, ...reverseUpdates]);

    console.log("\n🎉 Event is now live! Everyone can check their assignment in the app.");
    console.log("   Run \"npm run list-agents\" when ready to reveal all assignments and reset.\n");

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

main();
