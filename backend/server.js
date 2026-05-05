require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/database');

// Boot-time guard: refuse to start if JWT_SECRET is missing.
// Without this, tokens fall back to 'undefined' as the secret,
// which is predictable and effectively disables authentication.
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server will not start.');
  process.exit(1);
}

const app = express();

// Middleware
// CORS: restrict to the configured frontend origin in production.
// Set CORS_ORIGIN in your .env (e.g. http://localhost:5173 for local dev,
// or https://yourdomain.com for production). Falls back to all origins only
// if explicitly not set — flag this in production.
const allowedOrigin = process.env.CORS_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const authRoutes = require('./routes/authRoutes');
const billRoutes = require('./routes/billRoutes');
const clientRoutes = require('./routes/clientRoutes');
const masterRoutes = require('./routes/masterRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const reportRoutes       = require('./routes/reportRoutes');
const activityLogRoutes  = require('./routes/activityLogRoutes');

// Connect to database
connectDB();

// Health check route
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Billing System API is running',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/masters', masterRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/audit-log', activityLogRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;