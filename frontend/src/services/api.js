import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  getProfile: () => api.get('/auth/profile'),
  changePassword: (data) => api.post('/auth/change-password', data),
  register: (data) => api.post('/auth/register', data),
  verifyUserForReset: (data) => api.post('/auth/verify-user', data),
  resetPassword: (data) => api.post('/auth/reset-password', data),
};

// ============================================================================
// PAYMENT ENDPOINTS
// ============================================================================

export const paymentAPI = {
  markPayment:    (paymentData) => api.post('/payments', paymentData),
  getPaymentHistory: (billId)  => api.get(`/payments/bill/${billId}`),
  updatePayment:  (id, data)   => api.put(`/payments/${id}`, data),
  deletePayment:  (id)         => api.delete(`/payments/${id}`),
};

// ============================================================================
// BILL ENDPOINTS
// ============================================================================

export const billAPI = {
  createBill: (billData) => api.post('/bills', billData),
  getAllBills: (params) => api.get('/bills', { params }),
  getBillByNumber: (billNo) => api.get('/bills/search', { params: { bill_no: billNo } }),
  getBillById: (id) => api.get(`/bills/${id}`),
  updateBill: (id, billData, override = false) => api.put(`/bills/${id}`, { ...billData, override_edit: override }),
  deleteBill: (id) => api.delete(`/bills/${id}`),
  finalizeBill: (id) => api.put(`/bills/${id}/finalize`),
  generatePDF: (id) => api.get(`/bills/${id}/pdf`, { responseType: 'blob' }),
  downloadBill: (id) => api.get(`/bills/${id}/pdf`, { responseType: 'blob' }),
  sendEmail: (id, emailData) => api.post(`/bills/${id}/email`, emailData),
  addServiceToBill: (billId, serviceData) => api.post(`/bills/${billId}/services`, serviceData),
  deleteService: (serviceId) => api.delete(`/bills/services/${serviceId}`),
  mergeBills: (data) => api.post('/bills/merge', data),
  unmergeBill: (id) => api.post(`/bills/${id}/unmerge`),
  previewBillNumber: (params) => api.get('/bills/preview-number', { params }),
  writeOffBill: (id, data) => api.post(`/bills/${id}/writeoff`, data),
  // Edit lock
  acquireLock: (billId) => api.post(`/bills/${billId}/lock`),
  refreshLock: (billId) => api.put(`/bills/${billId}/lock/refresh`),
  releaseLock: (billId) => api.delete(`/bills/${billId}/lock`),
  checkLock: (billId) => api.get(`/bills/${billId}/lock`),
};

// ============================================================================
// CLIENT ENDPOINTS
// ============================================================================

export const clientAPI = {
  createClient: (clientData) => api.post('/clients', clientData),
  getAllClients: () => api.get('/clients'),
  searchClients: (searchTerm) => api.get(`/clients/search?query=${searchTerm}`),
  getClientById: (id) => api.get(`/clients/${id}`),
  updateClient: (id, clientData) => api.put(`/clients/${id}`, clientData),
  deleteClient: (id) => api.delete(`/clients/${id}`),
  bulkImport: (data) => api.post('/clients/bulk-import', data),
  bulkDelete: (data) => api.post('/clients/bulk-delete', data),
  exportClients: () => api.get('/clients/export'),
};

// ============================================================================
// MASTER DATA ENDPOINTS
// ============================================================================

export const masterAPI = {
  // Headers (Companies)
  getAllHeaders: () => api.get('/masters/headers'),
  getHeaderById: (id) => api.get(`/masters/headers/${id}`),
  createHeader: (headerData) => api.post('/masters/headers', headerData),
  updateHeader: (id, headerData) => api.put(`/masters/headers/${id}`, headerData),
  deleteHeader: (id) => api.delete(`/masters/headers/${id}`),

  // Particulars (Services)
  getAllParticulars: () => api.get('/masters/particulars'),
  createParticular: (data) => api.post('/masters/particulars', data),
  updateParticular: (id, data) => api.put(`/masters/particulars/${id}`, data),
  deleteParticular: (id) => api.delete(`/masters/particulars/${id}`),

  // GST Rates
  getAllGSTRates: () => api.get('/masters/gst-rates'),
  createGSTRate: (data) => api.post('/masters/gst-rates', data),
  updateGSTRate: (id, data) => api.put(`/masters/gst-rates/${id}`, data),
  deleteGSTRate: (id) => api.delete(`/masters/gst-rates/${id}`),

  // Payment Terms
  getAllPaymentTerms: () => api.get('/masters/payment-terms'),
  createPaymentTerm: (data) => api.post('/masters/payment-terms', data),
  updatePaymentTerm: (id, data) => api.put(`/masters/payment-terms/${id}`, data),
  deletePaymentTerm: (id) => api.delete(`/masters/payment-terms/${id}`),

  // Bank accounts per company (multi-bank — migration 006)
  getBankAccountsByHeader: (headerId) => api.get(`/masters/headers/${headerId}/bank-accounts`),
  addBankAccount: (headerId, data) => api.post(`/masters/headers/${headerId}/bank-accounts`, data),
  updateBankAccount: (headerId, bankId, data) => api.put(`/masters/headers/${headerId}/bank-accounts/${bankId}`, data),
  deleteBankAccount: (headerId, bankId) => api.delete(`/masters/headers/${headerId}/bank-accounts/${bankId}`),

  // Bank Accounts (for Mark Payment dropdown — all companies)
  getBankAccounts: () => api.get('/masters/bank-accounts'),
};



// ============================================================================
// USER MANAGEMENT ENDPOINTS (CA only)
// ============================================================================
export const userAPI = {
  getAllUsers:         ()         => api.get('/auth/users'),
  updateUser:         (id, data) => api.put(`/auth/users/${id}`, data),
  adminResetPassword: (id, data) => api.put(`/auth/users/${id}/reset-password`, data),
  createUser:         (data)     => api.post('/auth/register', data),
  // Pending approval (SUPERADMIN only)
  getPendingUsers:    ()         => api.get('/auth/users/pending'),
  getPendingCount:    ()         => api.get('/auth/users/pending-count'),
  approveUser:        (id)       => api.put(`/auth/users/${id}/approve`),
  rejectUser:         (id)       => api.delete(`/auth/users/${id}/reject`),
};

// ============================================================================
// REPORTS ENDPOINTS
// ============================================================================
export const reportAPI = {
  getDashboardKPIs:          (params) => api.get('/reports/dashboard-kpis',   { params }),
  getReceivables:            (params) => api.get('/reports/receivables',       { params }),
  getClientDetailedReport:   (params) => api.get('/reports/client-detailed',  { params }),
};

// ============================================================================
// AUDIT LOG ENDPOINTS (CA only)
// ============================================================================
export const activityLogAPI = {
  getActivityLog:        (params) => api.get('/audit-log',         { params }),
  getActivityLogByBill:  (params) => api.get('/audit-log/by-bill', { params }),
};

export default api;