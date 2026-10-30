import React, { useState } from 'react';
import { AlertTriangle, Copy, RefreshCw, CheckCircle2, Home } from 'lucide-react';
import { motion } from 'framer-motion';

const ErrorFallback = ({ error, resetError }) => {
  const [copied, setCopied] = useState(false);

  const errorPayload = {
    message: error?.message || 'Unknown error',
    stack: error?.stack || '',
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString()
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(errorPayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-sans text-gray-900 dark:text-gray-100">
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="max-w-xl w-full bg-white dark:bg-gray-800 shadow-2xl rounded-2xl overflow-hidden border border-red-100 dark:border-red-900/30"
      >
        <div className="bg-red-500 p-6 flex flex-col items-center justify-center text-white">
          <motion.div
            initial={{ rotate: -15, scale: 0.5 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          >
            <AlertTriangle className="w-16 h-16 mb-4 opacity-90" />
          </motion.div>
          <h2 className="text-2xl font-bold tracking-tight">Something went wrong</h2>
          <p className="mt-2 text-red-100 text-center text-sm">
            We've encountered an unexpected error. Don't worry, you can easily report this or try refreshing.
          </p>
        </div>
        
        <div className="p-6">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 dark:text-gray-400">Error Details</h3>
              <button 
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-full"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied Payload' : 'Copy Payload'}
              </button>
            </div>
            <div className="bg-gray-100 dark:bg-gray-950 rounded-xl p-4 overflow-x-auto border border-gray-200 dark:border-gray-800">
              <pre className="text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">
                {error?.message || 'An unexpected error occurred'}
              </pre>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              className="flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
            >
              <Home className="w-4 h-4" />
              Return to Dashboard
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={resetError}
              className="flex items-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-5 py-2 rounded-lg font-medium shadow-sm text-xs transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return <ErrorFallback error={this.state.error} resetError={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
