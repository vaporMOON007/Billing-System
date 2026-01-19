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
  markPayment: (paymentData) => api.post('/payments', paymentData),
  getPaymentHistory: (billId) => api.get(`/payments/bill/${billId}`),
  deletePayment: (id) => api.delete(`/payments/${id}`),
};

// ============================================================================
// BILL ENDPOINTS
// ============================================================================

export const billAPI = {
  createBill: (billData) => api.post('/bills', billData),
  getAllBills: (params) => api.get('/bills', { params }),
  getBillByNumber: (billNo) => api.get(`/bills/${billNo}`),
  updateBill: (id, billData) => api.put(`/bills/${id}`, billData),
  deleteBill: (id) => api.delete(`/bills/${id}`),
  finalizeBill: (id) => api.post(`/bills/${id}/finalize`),
  generatePDF: (id) => api.get(`/bills/${id}/pdf`),
  sendEmail: (id, emailData) => api.post(`/bills/${id}/email`, emailData),
  addServiceToBill: (billId, serviceData) => api.post(`/bills/${billId}/services`, serviceData),
  deleteService: (serviceId) => api.delete(`/bills/services/${serviceId}`),
  previewBillNumber: (params) => api.get('/bills/preview-number', { params }),

};

// ============================================================================
// CLIENT ENDPOINTS
// ============================================================================

export const clientAPI = {
  createClient: (clientData) => api.post('/clients', clientData),
  getAllClients: () => api.get('/clients'),
  searchClients: (searchTerm) => api.get(`/clients/search?q=${searchTerm}`),
  getClientById: (id) => api.get(`/clients/${id}`),
  updateClient: (id, clientData) => api.put(`/clients/${id}`, clientData),
  deleteClient: (id) => api.delete(`/clients/${id}`),
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
};



export default api;