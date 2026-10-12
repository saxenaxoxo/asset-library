import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { brandCssVariables } from '@brand/brand-config'
import App from './App'

for (const [name, value] of Object.entries(brandCssVariables())) {
  document.documentElement.style.setProperty(name, value)
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
