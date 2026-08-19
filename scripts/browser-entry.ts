// Build entry for the standalone browser bundle (bundle/index.js).
// Lives outside src/ so tsc does not emit it into dist/ — it exists only to
// attach the default export to the global scope, which the UMD wrapper that
// webpack used to generate did for us.
import Retter from '../src/index'

;(globalThis as any).Retter = Retter

export default Retter
