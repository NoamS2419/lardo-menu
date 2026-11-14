/* Firebase web config. These values are public by design (they identify the project, they are not secrets);
   access is controlled by firestore.rules (an API-key referrer restriction can be added in Google Cloud).
   Empty = leaderboard switched off, everything else works. */
// Team progress fields (onboarded, % known per category) on the board. Only switch on once the
// matching firestore.rules are published, or every score update would be refused.
export const TEAM_PROGRESS = true;

export const FIREBASE = {
  apiKey: 'AIzaSyBO0hmmRqyIkskmJbEBhohb5lw4RzEZgg0',
  projectId: 'lardo-menu'
};

// Local testing only: on localhost with ?emu in the address, everything goes to the Firebase emulators
// (tests/dev-server.mjs). The live site's CSP doesn't allow these addresses anyway.
const emu = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  && new URLSearchParams(location.search).has('emu');
export const EMULATOR = emu ? { auth: 'http://127.0.0.1:9099', firestore: 'http://127.0.0.1:8085' } : null;
