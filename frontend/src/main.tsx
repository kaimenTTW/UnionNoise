import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

// StrictMode is intentionally omitted: Fabric.js modifies the DOM during
// canvas initialisation and dispose(), which is incompatible with StrictMode's
// double-invocation of effects in development.
createRoot(root).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
