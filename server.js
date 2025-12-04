// filepath: backend/server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables as early as possible so all modules read the same values
dotenv.config();

const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const transferRoutes = require("./routes/transfer");
const referralRoutes = require("./routes/referral");
const contactRoutes = require('./routes/contact');
const messagesRoutes = require('./routes/messages');
const examRoutes = require('./routes/exam');
const app = express();
app.use(cors({
  origin: ["http://officialloanmortgage.in","https://officialloanmortgage.in", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.options("*", cors()); 
app.use(express.json());
// also accept urlencoded form bodies in case clients submit form-encoded data
app.use(express.urlencoded({ extended: true }));
const path = require('path');

// serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/jobportal";

connectDB(MONGO_URI); 

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
// payment routes removed (Stripe) — WatchPay integration will add new endpoints under /api/payment/watchpay
app.use("/api/transfer", transferRoutes);
app.use('/api/referral', referralRoutes);
// contact route should be registered after body parsers so req.body is populated
app.use('/api/contact', contactRoutes);
// public messages (chat)
app.use('/api/messages', messagesRoutes);
// exam endpoints
app.use('/api/exam', examRoutes);

app.get("/", (req, res) => res.send("JobPortal API"));
app.get("/my-ip", async (req, res) => {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    res.json({ outbound_ip: data.ip });
  } catch (err) {
    res.json({ error: "Could not fetch IP", details: err.message });
  }
});


app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));