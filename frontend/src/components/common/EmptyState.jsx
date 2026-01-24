import React from 'react';
import { FileText, Filter, Search, Inbox, DollarSign, AlertCircle } from 'lucide-react';

const EmptyState = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  type = 'default'
}) => {
  // Predefined empty states
  const presets = {
    noBills: {
      icon: FileText,
      title: 'No bills yet',
      description: 'Get started by creating your first bill. It only takes a minute!',
      actionLabel: 'Create First Bill',
    },
    noResults: {
      icon: Search,
      title: 'No results found',
      description: 'Try adjusting your filters or search terms to find what you\'re looking for.',
      actionLabel: 'Clear Filters',
    },
    noPayments: {
      icon: DollarSign,
      title: 'No payments recorded',
      description: 'This bill has no payment history yet. Record the first payment to get started.',
      actionLabel: 'Mark First Payment',
    },
    filtered: {
      icon: Filter,
      title: 'No bills match your filters',
      description: 'Try changing your date range, status, or other filter criteria.',
      actionLabel: 'Clear All Filters',
      secondaryActionLabel: 'Reset to Defaults',
    },
    error: {
      icon: AlertCircle,
      title: 'Something went wrong',
      description: 'We couldn\'t load the data. Please try refreshing the page.',
      actionLabel: 'Refresh Page',
    },
    welcome: {
      icon: Inbox,
      title: 'Welcome to your billing system!',
      description: 'Start managing your bills, clients, and payments all in one place.',
      actionLabel: 'Get Started',
    },
  };

  const preset = presets[type] || {};
  const FinalIcon = Icon || preset.icon || Inbox;
  const finalTitle = title || preset.title;
  const finalDescription = description || preset.description;
  const finalActionLabel = actionLabel || preset.actionLabel;
  const finalSecondaryActionLabel = secondaryActionLabel || preset.secondaryActionLabel;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      {/* Icon */}
      <div className="w-24 h-24 mb-6 bg-gray-100 rounded-full flex items-center justify-center">
        <FinalIcon className="w-12 h-12 text-gray-400" />
      </div>

      {/* Title */}
      <h3 className="text-xl font-semibold text-gray-900 mb-2">
        {finalTitle}
      </h3>

      {/* Description */}
      <p className="text-gray-600 text-center max-w-md mb-6">
        {finalDescription}
      </p>

      {/* Actions */}
      <div className="flex space-x-3">
        {onAction && finalActionLabel && (
          <button
            onClick={onAction}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
          >
            {finalActionLabel}
          </button>
        )}
        
        {onSecondaryAction && finalSecondaryActionLabel && (
          <button
            onClick={onSecondaryAction}
            className="px-6 py-2.5 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            {finalSecondaryActionLabel}
          </button>
        )}
      </div>
    </div>
  );
};

export default EmptyState;