"use strict";

// In-memory online user store: { userId -> { socketId, name } }
const onlineUsers = {};

function addUser(userId, socketId, name) {
  onlineUsers[userId] = { socketId, name };
}

function removeUser(userId) {
  delete onlineUsers[userId];
}

function getUser(userId) {
  return onlineUsers[userId] || null;
}

function getAllUsers() {
  return onlineUsers;
}

module.exports = { addUser, removeUser, getUser, getAllUsers };
