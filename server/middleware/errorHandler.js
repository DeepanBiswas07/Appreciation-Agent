"use strict";

function notFound(req, res) {
  res.status(404).json({ success: false, error: "Not found" });
}

function errorHandler(err, req, res, _next) {
  console.error(err);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
}

module.exports = { notFound, errorHandler };
