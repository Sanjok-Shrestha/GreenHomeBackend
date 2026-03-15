function errorHandler(err, req, res, next) {
  console.error("Unhandled error:", err);

  // Multer errors
  if (err.name === "MulterError") {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File too large (max 5MB)" : err.message;
    return res.status(400).json({ message });
  }

  // Generic errors
  const status = err.status || err.statusCode || 500;
  const body = { message: err.message || "Internal server error" };

  if (process.env.NODE_ENV !== "production") {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}

module.exports = { errorHandler };