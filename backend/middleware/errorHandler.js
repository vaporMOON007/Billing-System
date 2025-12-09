const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err);

  // Default error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // PostgreSQL errors
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique violation
        statusCode = 409;
        message = 'Duplicate entry. Record already exists.';
        break;
      case '23503': // Foreign key violation
        statusCode = 400;
        message = 'Invalid reference. Related record not found.';
        break;
      case '23502': // Not null violation
        statusCode = 400;
        message = 'Required field is missing.';
        break;
      case '22P02': // Invalid text representation
        statusCode = 400;
        message = 'Invalid data format.';
        break;
      default:
        message = 'Database error occurred.';
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token.';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired.';
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;