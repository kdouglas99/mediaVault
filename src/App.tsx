import { useState, useEffect, useRef } from 'react'
import { testConnection, getItems, getStats, importCSV, initializeDatabase } from './lib/database'
import ErrorBoundary from './components/ErrorBoundary'
import './App.css'

interface MediaItem {
  id: string;
  title: string;
  series_title?: string;
  content_type?: string;
}

interface Stats {
  totalItems: number;
  totalSeries: number;
}

function App() {
  const [dbStatus, setDbStatus] = useState<string>('Checking...')
  const [items, setItems] = useState<MediaItem[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [importProgress, setImportProgress] = useState<string>('')
  const [isOperationInProgress, setIsOperationInProgress] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkDatabase()
  }, [])

  const checkDatabase = async () => {
    setIsLoading(true)
    const result = await testConnection()
    
    if (result.success) {
      setDbStatus(`Connected at ${new Date(result.time).toLocaleString()}`)
      const [mediaItems, statsData] = await Promise.all([
        getItems({ limit: 10 }),
        getStats()
      ])
      setItems(mediaItems)
      setStats(statsData)
    } else {
      setDbStatus(`Error: ${result.error}`)
    }
    setIsLoading(false)
  }

  // Add this function INSIDE the component, before the return statement
  const handleInitDatabase = async () => {
    setIsLoading(true);
    setImportProgress('Initializing database schema...');
    
    try {
      const result = await initializeDatabase();
      
      if (result.success) {
        setImportProgress('Database schema initialized successfully!');
        setTimeout(() => {
          checkDatabase();
        }, 1000);
      } else {
        setImportProgress(`Database initialization failed: ${result.error}`);
      }
    } catch (error) {
      setImportProgress(`Database initialization failed: ${error}`);
    }
    
    setIsLoading(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setUploadFile(file)
      setImportProgress('')
      console.log('File selected:', file.name)
    }
  }

const handleFileUpload = async () => {
  if (isOperationInProgress || !uploadFile) return;
  
  setIsOperationInProgress(true);
    
    setIsLoading(true)
    setImportProgress('Uploading and processing CSV...')
    
    try {
      const result = await importCSV(uploadFile)
      
      if (result.success) {
        setImportProgress(`Success! ${result.message}`)
        setUploadFile(null)
        setTimeout(() => {
          checkDatabase()
        }, 1000)
      } else {
        setImportProgress(`Import failed: ${result.error}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setImportProgress(`Import failed: ${errorMessage}`);
    }
    
    setIsLoading(false)
    setIsOperationInProgress(false);
  };

  return (
    <ErrorBoundary>
      <div className="App">
        <h1>🎬 Media Vault</h1>
      
      <div className="card">
        <h2>📡 Database Status</h2>
        <p>{dbStatus}</p>
        {isLoading && <p>⏳ Loading...</p>}
      </div>

      {/* CSV Import Section - Always Visible */}
      <div className="card">
        <h2>📤 Import CSV Data</h2>
        <div style={{ padding: '20px', border: '2px solid #ccc', borderRadius: '8px', margin: '10px 0' }}>
          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            onChange={handleFileSelect}
            disabled={isLoading}
            style={{ marginBottom: '10px', width: '100%' }}
          />
          
          {uploadFile && (
            <div style={{ background: '#f0f0f0', padding: '10px', margin: '10px 0', borderRadius: '4px' }}>
              <p>📄 Selected: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)</p>
            </div>
          )}

          <button
            onClick={handleInitDatabase}
            disabled={isLoading}
            style={{
              background: '#2196F3',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '4px',
              cursor: 'pointer',
              marginRight: '10px'
            }}
          >
            🔧 Initialize Database
          </button>

          <button
            onClick={handleFileUpload}
            disabled={isLoading || !uploadFile}
            style={{
              background: uploadFile ? '#4CAF50' : '#cccccc',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '4px',
              cursor: uploadFile ? 'pointer' : 'not-allowed',
              marginRight: '10px'
            }}
          >
            {isLoading ? '⏳ Importing...' : '🚀 Import CSV'}
          </button>

          <button
            onClick={() => {
              setUploadFile(null);
              setImportProgress('');
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
            }}
            style={{
              background: '#f44336',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            ❌ Clear
          </button>

          {importProgress && (
            <div
              style={{
              background: importProgress.includes('Success') ? '#d4edda' : '#f8d7da',
              color: importProgress.includes('Success') ? '#155724' : '#721c24',
              padding: '10px',
              margin: '10px 0',
              borderRadius: '4px'
            }}>
              <p>{importProgress}</p>
            </div>
          )}
        </div>
      </div>

      {/* Stats Section */}
      {stats && (
        <div className="card">
          <h2>📊 Statistics</h2>
          <p>Total Items: {stats.totalItems}</p>
          <p>Total Series: {stats.totalSeries}</p>
        </div>
      )}

      {/* Media Items Section */}
      <div className="card">
        <h2>📺 Media Items ({items.length})</h2>
        {items.length > 0 ? (
          items.map((item, index) => (
            <div key={item.id || index} style={{ background: '#f9f9f9', padding: '10px', margin: '5px 0', borderRadius: '4px' }}>
              <h4>{item.title}</h4>
              {item.series_title && <p>Series: {item.series_title}</p>}
              {item.content_type && <p>Type: {item.content_type}</p>}
            </div>
          ))
        ) : (
          <p>No media items found. Upload a CSV file above to import your data.</p>
        )}
      </div>
      </div>
    </ErrorBoundary>
  )
}

export default App
