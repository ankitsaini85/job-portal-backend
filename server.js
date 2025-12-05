// filepath: backend/server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
const iconv = require("iconv-lite");


 // if not already imported
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


// Convert UTF-8 → GBK (same as PHP convToGBK)
function toGBK(str) {
  return iconv.encode(str, "gbk");
}

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

app.get("/api/test-watchpay", async (req, res) => {
  try {
    const params = {
      version: "1.0",
      goods_name: "wallet",
      mch_id: "100666761",
      mch_order_no: "ORD20251205133938",
      notify_url: "https://job-portal-backend-ctvu.onrender.com/api/payment/watchpay/callback",
      order_date: "2025-12-05 13:39:38",
      pay_type: "101",
      trade_amount: "100",
      sign_type: "MD5"
    };

    // Build SIGN STRING in correct order
    let signStr =
      "goods_name=" + params.goods_name +
      "&mch_id=" + params.mch_id +
      "&mch_order_no=" + params.mch_order_no +
      "&notify_url=" + params.notify_url +
      "&order_date=" + params.order_date +
      "&pay_type=" + params.pay_type +
      "&trade_amount=" + params.trade_amount +
      "&version=" + params.version +
      // "&key=3AHN5CREKH4PBSYO8VVP4B8MGGIYKOY9";
      "&key=FKGCUNNQBIMJGAQAVGEDF6QUW0LNO3FB";

    console.log("\n----- UTF8 SIGN STRING (before GBK) -----");
    console.log(signStr);

    // Convert FULL STRING to GBK before hashing
    const gbkBuffer = toGBK(signStr);
    const sign = md5(gbkBuffer);

    console.log("\n----- GENERATED SIGN (GBK MD5) -----");
    console.log(sign);

    // Prepare POST form body
    const formData = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => formData.append(k, v));
    formData.append("sign", sign);

    console.log("\n----- RAW BODY SENT -----");
    console.log(formData.toString());

    const response = await fetch("https://api.watchglb.com/pay/web", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData
    });

    const html = await response.text();
    return res.send(html);

  } catch (err) {
    return res.json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
