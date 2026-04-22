const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "SECRET_KEY";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "1d";

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function normalizePhone(p = "") {
  if (!p) return "";
  return String(p).replace(/\D/g, "");
}

function n(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Build a normalized address object from request body.
 */
function buildAddressFromBody(body) {
  if (!body) return null;

  if (body.address && typeof body.address === "object") {
    const a = body.address;
    if (a.line1 || a.line2 || a.city || a.state || a.postalCode || a.country) {
      return {
        line1: n(a.line1),
        line2: n(a.line2),
        city: n(a.city),
        state: n(a.state),
        postalCode: n(a.postalCode),
        country: n(a.country),
      };
    }
  }

  if (body.addressString && typeof body.addressString === "string") {
    const s = n(body.addressString);
    if (s) return { line1: s, line2: null, city: null, state: null, postalCode: null, country: null };
  }

  const line1 = n(body.addressLine1 ?? body.address1 ?? body.address);
  const line2 = n(body.addressLine2 ?? body.address2 ?? null);
  const city = n(body.city);
  const state = n(body.state);
  const postalCode = n(body.postalCode ?? body.postcode ?? body.zip);
  const country = n(body.country);

  const any = line1 || line2 || city || state || postalCode || country;
  if (!any) return null;

  return { line1, line2, city, state, postalCode, country };
}

exports.register = async (req, res) => {
  try {
    console.log("REGISTER payload keys:", Object.keys(req.body));

    const { name, email, password, role = "user", phone } = req.body;
    const usernameRaw = req.body?.username;
    const username = usernameRaw ? String(usernameRaw).trim() : null;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    const emailNorm = String(email).toLowerCase().trim();
    const nameNorm = String(name).trim();
    const phoneNorm = phone ? normalizePhone(phone) : "";

    const addressObj = buildAddressFromBody(req.body);

    // Check duplicates: email, phone, username
    const orConditions = [{ email: emailNorm }];
    if (phoneNorm) orConditions.push({ phone: phoneNorm });
    if (username) orConditions.push({ username });

    const existing = await User.findOne({ $or: orConditions }).lean();
    if (existing) {
      if (existing.email === emailNorm) {
        return res.status(409).json({ field: "email", message: "Email already in use" });
      }
      if (phoneNorm && existing.phone === phoneNorm) {
        return res.status(409).json({ field: "phone", message: "Phone number already in use" });
      }
      if (username && existing.username === username) {
        return res.status(409).json({ field: "username", message: "Username already in use" });
      }
      return res.status(409).json({ message: "Account already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const isCollector = role === "collector";

    const user = await User.create({
      name: nameNorm,
      username: username || undefined,
      email: emailNorm,
      phone: phoneNorm || undefined,
      password: hashedPassword,
      role,
      isApproved: isCollector ? false : true,
      active: !isCollector,
      status: isCollector ? "applied" : "approved",
      address: addressObj,
    });

    const safeUser = {
      id: user._id,
      name: user.name,
      username: user.username ?? null,
      email: user.email,
      role: user.role,
      isApproved: user.isApproved,
      points: user.points ?? 0,
      phone: user.phone ?? null,
      address: user.address ?? null,
    };

    if (isCollector) {
      return res.status(201).json({
        code: "AWAITING_APPROVAL",
        message: "Collector registration received. Awaiting admin approval.",
        user: safeUser,
      });
    }

    const token = signToken(user);
    return res.status(201).json({ token, user: safeUser });
  } catch (error) {
    console.error("Register error:", error && error.stack ? error.stack : error);

    if (error && (error.code === 11000 || (error.name === "MongoServerError" && error.code === 11000))) {
      const key = Object.keys(error.keyValue || {})[0] || null;
      return res.status(409).json({ field: key || "field", message: `${key || "Field"} already in use` });
    }

    if (process.env.NODE_ENV !== "production") {
      return res.status(500).json({ message: String(error?.message || "Server error"), stack: error?.stack });
    }

    return res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const rawIdentifier = req.body?.email || req.body?.identifier || req.body?.username || "";
    const rawPassword = req.body?.password;

    const identifier = typeof rawIdentifier === "string" ? rawIdentifier.trim() : "";
    const password = typeof rawPassword === "string" ? rawPassword : "";

    if (!identifier || !password) {
      return res.status(400).json({ code: "MISSING_CREDENTIALS", message: "Email/username and password are required" });
    }

    const isEmail = identifier.includes("@");

    const query = isEmail
      ? { email: identifier.toLowerCase() }
      : { $or: [{ username: identifier }, { email: identifier.toLowerCase() }] };

    const user = await User.findOne(query);
    if (!user) {
      return res.status(400).json({ code: "INVALID_CREDENTIALS", message: "Invalid credentials" });
    }

    let isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch && user.password === password) {
      isMatch = true;
      user.password = await bcrypt.hash(password, 10);
      await user.save();
    }

    if (!isMatch) {
      return res.status(400).json({ code: "INVALID_CREDENTIALS", message: "Invalid credentials" });
    }

    if (user.role === "collector" && user.isApproved === false) {
      return res.status(403).json({
        code: "ACCOUNT_NOT_APPROVED",
        message: "Account not approved yet",
        help: "Collector accounts require admin approval before login. Contact support if urgent.",
      });
    }

    const token = signToken(user);
    const safeUser = {
      id: user._id,
      name: user.name,
      username: user.username ?? null,
      email: user.email,
      role: user.role,
      isApproved: user.isApproved,
      points: user.points ?? 0,
      phone: user.phone ?? null,
      address: user.address ?? null,
    };

    return res.json({ token, user: safeUser });
  } catch (error) {
    console.error("Login error:", error && error.stack ? error.stack : error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.me = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const user = await User.findById(userId).select("-password -__v");
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({ user });
  } catch (err) {
    console.error("auth.me error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to fetch user" });
  }
};