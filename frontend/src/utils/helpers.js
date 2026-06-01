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

// GSTIN and PAN validation regexes — single source of truth
// Import these wherever GSTIN/PAN validation is needed
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX   = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

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