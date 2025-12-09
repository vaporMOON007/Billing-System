import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

const SearchableDropdown = ({ 
  label, 
  value, 
  onChange, 
  options, 
  placeholder, 
  required,
  onSearch,
  allowCreate = false,
  onCreate
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredOptions, setFilteredOptions] = useState(options || []);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (searchTerm) {
      if (onSearch) {
        onSearch(searchTerm);
      } else {
        const filtered = (options || []).filter((option) =>
          option.label.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setFilteredOptions(filtered);
      }
    } else {
      setFilteredOptions(options || []);
    }
  }, [searchTerm, options, onSearch]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (option) => {
    onChange(option.value);
    setSearchTerm(option.label);
    setIsOpen(false);
  };

  const handleCreate = () => {
    if (onCreate && searchTerm) {
      onCreate(searchTerm);
      setIsOpen(false);
    }
  };

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className="w-full" ref={dropdownRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <div className="relative">
          <input
            type="text"
            value={isOpen ? searchTerm : (selectedOption?.label || '')}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          {selectedOption && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setSearchTerm('');
              }}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option)}
                  className="w-full px-4 py-2 text-left hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                >
                  {option.label}
                </button>
              ))
            ) : (
              <div className="px-4 py-2 text-gray-500 text-sm">
                No results found
                {allowCreate && searchTerm && (
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="block mt-2 text-primary-600 hover:text-primary-700 font-medium"
                  >
                    + Create "{searchTerm}"
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchableDropdown;