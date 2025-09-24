import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // In production, you might want to send this to an error reporting service
    // Example: errorReportingService.captureException(error, { extra: errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          backgroundColor: '#1f2937',
          color: '#ffffff',
          borderRadius: '8px',
          margin: '1rem',
          border: '1px solid #ef4444'
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '1rem' }}>
            🚨 Something went wrong
          </h2>
          <p style={{ marginBottom: '1rem', color: '#d1d5db' }}>
            An unexpected error occurred. Please try refreshing the page.
          </p>
          
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details style={{ 
              textAlign: 'left', 
              marginTop: '1rem',
              backgroundColor: '#111827',
              padding: '1rem',
              borderRadius: '4px',
              border: '1px solid #374151'
            }}>
              <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
                Error Details (Development Only)
              </summary>
              <pre style={{ 
                fontSize: '0.8rem', 
                color: '#ef4444',
                overflow: 'auto',
                whiteSpace: 'pre-wrap'
              }}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
          
          <div style={{ marginTop: '1rem' }}>
            <button
              onClick={this.handleRetry}
              style={{
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                cursor: 'pointer',
                marginRight: '0.5rem'
              }}
            >
              🔄 Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              🔄 Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
