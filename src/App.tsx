import { useState, useEffect } from 'react'
import { testConnection, getItems } from './lib/database'
import './App.css'

function App() {
  const [dbStatus, setDbStatus] = useState<string>('Checking...')
  const [items, setItems] = useState<any[]>([])

  useEffect(() => {
    const checkDatabase = async () => {
      const result = await testConnection()
      if (result.success) {
        setDbStatus(`Connected at ${result.time}`)
        const mediaItems = await getItems()
        setItems(mediaItems)
      } else {
        setDbStatus(`Error: ${result.error}`)
      }
    }

    checkDatabase()
  }, [])

  return (
    <div className="App">
      <h1>Media Vault</h1>
      
      <div className="card">
        <h2>Database Status</h2>
        <p>{dbStatus}</p>
      </div>

      <div className="card">
        <h2>Media Items ({items.length})</h2>
        {items.length > 0 ? (
          <ul>
            {items.map((item, index) => (
              <li key={index}>
                {item.title || item.name || `Item ${item.id}`}
              </li>
            ))}
          </ul>
        ) : (
          <p>No items found. Make sure you have a 'media_items' table.</p>
        )}
      </div>
    </div>
  )
}

export default App
