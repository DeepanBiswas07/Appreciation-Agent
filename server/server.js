"use strict";

require("dotenv").config();

const http = require("http");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");


const { connectDB } = require("./config/db");
const { initSocket } = require("./sockets");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");

const isProduction = process.env.NODE_ENV === "production";

function buildAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || "";
  if (!raw || raw.trim() === "*") return isProduction ? [] : "*";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

const corsOptions = {
  origin: buildAllowedOrigins(),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
};



const app = express();

if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== "0") {
  app.set("trust proxy", process.env.TRUST_PROXY);
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://fonts.googleapis.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc:    ["'self'", "ws:", "wss:", "http:", "https:"],
      styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:       ["'self'", "https://fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:"],
      objectSrc:     ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  strictTransportSecurity: false,
  crossOriginOpenerPolicy: false,
}));

app.use(compression());
app.use(morgan(isProduction ? "combined" : "dev", { skip: (req) => req.url === "/health" }));
app.use(cors(corsOptions));
app.options("/{*any}", cors(corsOptions));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Inject server URL for the frontend
app.get("/env.js", (_req, res) => {
  res.type("application/javascript");
  res.send(`window.ENV = { SERVER_URL: "${process.env.SERVER_URL || ""}" };`);
});

// Auth routes (register / login)
app.use("/auth", authRoutes);

// Protected API routes
app.use("/api", userRoutes);

// Serve static frontend (AFTER API routes)
app.use(express.static("public"));
// SPA fallback
app.get("/{*any}", (_req, res) => res.sendFile("index.html", { root: "public" }));



connectDB();

const server = http.createServer(app);
const io = initSocket(server);

// Admin route used by local scripts to broadcast events
app.post("/api/admin/reset", (_req, res) => {
  if (io) io.emit("event_reset");
  res.json({ success: true });
});

app.use(notFound);
app.use(errorHandler);

const port = parseInt(process.env.PORT, 10) || 3000;
const host = process.env.HOST || "0.0.0.0";

if (!process.env.JWT_SECRET) {
  console.error("❌ Missing JWT_SECRET in .env");
  process.exit(1);
}

server.listen(port, host, () => {
  console.log(`🚀 Secret Appreciation Agent running on http://${host}:${port}`);
  console.log(`   Run "npm run start-event" to assign agents once everyone has registered.`);
});
