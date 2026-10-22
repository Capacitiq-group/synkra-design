/**
 * The studio island's client entry: stylesheet chain, contrast init and the app router,
 * exactly as the standalone app's index bootstrapped them.
 */
import '@fontsource-variable/inter'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/nunito'
import '@fontsource-variable/nunito/wght-italic.css'
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/fraunces/opsz-italic.css'
import '@fontsource-variable/caveat'
import './styles/tokens.css'
import './styles/synkra.css'
import './styles/global.css'
import { initContrast } from './lib/contrast'
import App from './App'

// Before the first render, so high contrast is on from the first paint.
if (typeof document !== 'undefined') initContrast()

export default function StudioIsland() {
  return (
    <div id="root" style={{ minHeight: '100dvh' }}>
      <App />
    </div>
  )
}
