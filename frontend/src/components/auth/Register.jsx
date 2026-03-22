import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus, Eye, EyeOff, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { authAPI } from '../../services/api';

const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    phone: '',
    role: 'EMPLOYEE'
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);

  const calculatePasswordStrength = (password) => {
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 10) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[!@#$%^&*]/.test(password)) strength++;
    return Math.min(strength, 5);
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (!/^[0-9]{10}$/.test(formData.phone)) {
      toast.error('Phone number must be 10 digits');
      return;
    }

    setLoading(true);

    try {
      const response = await authAPI.register({
        username: formData.username,
        email: formData.email,
        password: formData.password,
        full_name: formData.full_name,
        phone: formData.phone,
        role: formData.role
      });

      if (response.data.success) {
        if (response.data.pending_approval) {
          // Self-registration — show pending approval screen
          setPendingApproval(true);
        } else {
          // Should not happen for self-registration, but handle gracefully
          toast.success('Registration successful!');
          navigate('/login');
        }
      }
    } catch (error) {
      console.error('Registration error:', error);
      toast.error(error.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // Show pending approval screen after successful self-registration
  if (pendingApproval) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 py-12 px-4">
        <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md text-center">
          <div className="flex items-center justify-center mb-6">
            <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center">
              <Clock className="w-10 h-10 text-yellow-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Account Pending Approval</h2>
          <p className="text-gray-600 mb-6">
            Your account has been created successfully! An administrator needs to approve your registration before you can log in.
            Please check back later or contact your administrator.
          </p>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm font-semibold text-yellow-800 mb-1">What happens next?</p>
            <ul className="text-sm text-yellow-700 space-y-1 list-disc list-inside">
              <li>Your administrator will review your registration</li>
              <li>Once approved, you can log in with your credentials</li>
              <li>If rejected, you will need to register again</li>
            </ul>
          </div>
          <Link
            to="/login"
            className="block w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors"
          >
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 py-12 px-4">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-primary-600 rounded-full flex items-center justify-center">
              <UserPlus className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Create Account</h1>
          <p className="text-gray-600 mt-2">Join our billing system</p>
        </div>

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Enter your full name"
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Choose a username"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="your.email@example.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              required
              pattern="[0-9]{10}"
              maxLength={10}
              onInput={(e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');
              }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="10 digit phone number"
            />
          </div>

          {/* Role Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role <span className="text-red-500">*</span>
            </label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="EMPLOYEE">Employee</option>
              <option value="CA">CA (Chartered Accountant)</option>
            </select>
          </div>

          {/* Password with Strength Indicator */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                minLength={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="At least 6 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            
            {/* NEW: Password Strength Meter */}
            {formData.password && (
              <div className="mt-2 space-y-2">
                {/* Strength Bar */}
                <div className="flex space-x-1">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 rounded ${
                        level <= calculatePasswordStrength(formData.password)
                          ? calculatePasswordStrength(formData.password) <= 2
                            ? 'bg-red-500'
                            : calculatePasswordStrength(formData.password) <= 4
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                          : 'bg-gray-200'
                      }`}
                    ></div>
                  ))}
                </div>
                
                {/* Strength Label */}
                <p className={`text-xs font-medium ${
                  calculatePasswordStrength(formData.password) <= 2
                    ? 'text-red-600'
                    : calculatePasswordStrength(formData.password) <= 4
                    ? 'text-yellow-600'
                    : 'text-green-600'
                }`}>
                  {calculatePasswordStrength(formData.password) <= 2
                    ? 'Weak Password'
                    : calculatePasswordStrength(formData.password) <= 4
                    ? 'Medium Password'
                    : 'Strong Password'}
                </p>
                
                {/* Requirements Checklist */}
                <div className="space-y-1 text-xs">
                  <div className={`flex items-center space-x-2 ${formData.password.length >= 6 ? 'text-green-600' : 'text-gray-500'}`}>
                    <span>{formData.password.length >= 6 ? '✓' : '✗'}</span>
                    <span>At least 6 characters</span>
                  </div>
                  <div className={`flex items-center space-x-2 ${/[A-Z]/.test(formData.password) ? 'text-green-600' : 'text-gray-500'}`}>
                    <span>{/[A-Z]/.test(formData.password) ? '✓' : '✗'}</span>
                    <span>Contains uppercase letter</span>
                  </div>
                  <div className={`flex items-center space-x-2 ${/[a-z]/.test(formData.password) ? 'text-green-600' : 'text-gray-500'}`}>
                    <span>{/[a-z]/.test(formData.password) ? '✓' : '✗'}</span>
                    <span>Contains lowercase letter</span>
                  </div>
                  <div className={`flex items-center space-x-2 ${/[0-9]/.test(formData.password) ? 'text-green-600' : 'text-gray-500'}`}>
                    <span>{/[0-9]/.test(formData.password) ? '✓' : '✗'}</span>
                    <span>Contains number</span>
                  </div>
                  <div className={`flex items-center space-x-2 ${/[!@#$%^&*]/.test(formData.password) ? 'text-green-600' : 'text-gray-500'}`}>
                    <span>{/[!@#$%^&*]/.test(formData.password) ? '✓' : '✗'}</span>
                    <span>Contains special character (!@#$%^&*)</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Re-enter password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-6"
          >
            {loading ? (
              <div className="flex items-center justify-center">
                <div className="spinner w-5 h-5 border-2 mr-2"></div>
                Creating Account...
              </div>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        {/* Login Link */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{' '}
            <Link
              to="/login"
              className="text-primary-600 hover:text-primary-700 font-medium"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;