// The legacy CR-30 single-printer configuration has been retired.
// Settings now uses the UI-managed multi-printer OctoPrint registry.
import { OctoPrintManager } from '../pages/OctoPrintManager';
export function OctoPrintSettings() { return <OctoPrintManager />; }