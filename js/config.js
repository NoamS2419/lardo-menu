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
