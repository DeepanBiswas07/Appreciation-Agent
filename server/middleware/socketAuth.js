"use strict";

const jwt = require("jsonwebtoken");

function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace("Bearer ", "");
  if (!token) return next(new Error("Authentication error: missing token"));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    socket.data.userId = payload.userId;
    socket.data.name   = payload.name;
    next();
  } catch {
    next(new Error("Authentication error: invalid token"));
  }
}

module.exports = { socketAuthMiddleware };
