import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './voxel.tsx'
// import App from './App copy.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
