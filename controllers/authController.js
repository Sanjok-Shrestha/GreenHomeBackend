const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "SECRET_KEY";
const JWT_EXPIRES = "1d";

function signToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

exports.register = async (req, res) => {
  try {
    const { name, email, password, role = "user" } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const isCollector = role === "collector";
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      isApproved: isCollector ? false : true,
    });

    const safeUser = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isApproved: user.isApproved,
      points: user.points ?? 0,
    };

    // If collector: do NOT issue token yet — await admin approval
    if (isCollector) {
      return res.status(201).json({
        code: "AWAITING_APPROVAL",
        message: "Collector registration received. Awaiting admin approval.",
        user: safeUser,
      });
    }

    // For regular users: sign token and return
    const token = signToken(user);
    return res.status(201).json({
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    // Accept common frontend payload variations.
    const rawIdentifier = req.body?.email || req.body?.identifier || req.body?.username || req.body?.name;
    const rawPassword = req.body?.password;

    const identifier = typeof rawIdentifier === "string" ? rawIdentifier.trim() : "";
    const password = typeof rawPassword === "string" ? rawPassword : "";

    if (!identifier || !password) {
      return res.status(400).json({
        code: "MISSING_CREDENTIALS",
        message: "Email/username and password are required",
      });
    }

    // Prefer email lookup; if no '@', treat identifier as username/name fallback.
    const query = identifier.includes("@")
      ? { email: identifier.toLowerCase() }
      : { $or: [{ email: identifier.toLowerCase() }, { name: identifier }] };

    const user = await User.findOne(query);
    if (!user) {
      return res.status(400).json({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials",
      });
    }

    let isMatch = await bcrypt.compare(password, user.password);

    // Compatibility path: allow one-time login for legacy plain-text passwords,
    // then immediately migrate stored password to bcrypt hash.
    if (!isMatch && user.password === password) {
      isMatch = true;
      user.password = await bcrypt.hash(password, 10);
      await user.save();
    }

    if (!isMatch) {
      return res.status(400).json({
        code: "INVALID_CREDENTIALS",
        message: "Invalid credentials",
      });
    }

    // If collector and not yet approved -> forbid login with structured response
    if (user.role === "collector" && user.isApproved === false) {
      return res.status(403).json({
        code: "ACCOUNT_NOT_APPROVED",
        message: "Account not approved yet",
        help: "Collector accounts require admin approval before login. Contact support if urgent.",
      });
    }

    const token = signToken(user);
    const safeUser = {
      id: user._id, // FIXED: was user._1d (typo) in original code
      name: user.name,
      email: user.email,
      role: user.role,
      isApproved: user.isApproved,
      points: user.points ?? 0,
    };

    return res.json({
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/auth/me
// Returns current authenticated user (re-queries DB to ensure fresh fields)
exports.me = async (req, res) => {
  try {
    // protect middleware should set req.user.id
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const user = await User.findById(userId).select("-password -__v");
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({ user });
  } catch (err) {
    console.error("auth.me error:", err);
    return res.status(500).json({ message: "Failed to fetch user" });
  }
};