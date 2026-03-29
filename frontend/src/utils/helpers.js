// Format currency
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount);
};

// Format date
export const formatDate = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

// Get financial year from date
export const getFinancialYear = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  if (month >= 4) {
    return `${year}-${String(year + 1).slice(-2)}`;
  } else {
    return `${year - 1}-${String(year).slice(-2)}`;
  }
};

// Generate year options for dropdown
export const getYearOptions = () => {
  const today = new Date();
  const month = today.getMonth() + 1; // 1-based
  const year = today.getFullYear();
  // Current FY end year: if April or later, current year is FY start → end = year+1
  const currentFYEnd = month >= 4 ? year + 1 : year;
  const startFYEnd = 2019; // FY 2018-19
  const fyOptions = [];
  for (let endYear = startFYEnd; endYear <= currentFYEnd; endYear++) {
    fyOptions.push(`${endYear - 1}-${String(endYear).slice(-2)}`);
  }
  return fyOptions;
};

// Calculate GST amount
export const calculateGST = (amount, gstRate) => {
  return (amount * gstRate) / 100;
};

// Validate email
export const isValidEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

// Validate phone
export const isValidPhone = (phone) => {
  const regex = /^[0-9]{10}$/;
  return regex.test(phone);
};

// Debounce function for search
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};