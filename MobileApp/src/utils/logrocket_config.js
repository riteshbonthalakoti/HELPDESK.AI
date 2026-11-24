// LogRocket Privacy Masking Configuration
// Safely guarded no-op stub for Mobile APK builds to prevent native crashing on Android New Architecture

export const initLogRocket = () => {
  // LogRocket disabled on standalone Android APK to ensure clean build stability
};

export const LogRocket = {
  init: initLogRocket,
  identify: () => {},
  captureException: () => {},
  track: () => {},
  getSessionURL: (cb) => {
    if (typeof cb === 'function') cb(null);
  },
};

export default {
  initLogRocket,
  LogRocket,
};
