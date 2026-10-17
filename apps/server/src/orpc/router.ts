import { os } from "./context";
import * as account from "./procedures/account";
import * as admin from "./procedures/admin";
import * as discover from "./procedures/discover";
import * as imports from "./procedures/imports";
import * as library from "./procedures/library";
import * as mediaRequests from "./procedures/mediaRequests";
import * as notifications from "./procedures/notifications";
import * as people from "./procedures/people";
import * as playbackDevices from "./procedures/playbackDevices";
import * as playbackReporting from "./procedures/playbackReporting";
import * as system from "./procedures/system";
import * as titles from "./procedures/titles";
import * as tracking from "./procedures/tracking";

export const implementedRouter = {
  titles: {
    get: titles.get,
    similar: titles.similar,
    pendingLibrary: titles.pendingLibrary,
  },
  tracking: {
    watch: tracking.watch,
    unwatch: tracking.unwatch,
    watchNext: tracking.watchNext,
    unwatchLast: tracking.unwatchLast,
    rewatch: tracking.rewatch,
    updateStatus: tracking.updateStatus,
    rate: tracking.rate,
    userInfo: tracking.userInfo,
    stats: tracking.stats,
  },
  library: {
    list: library.list,
    genres: library.genres,
    stats: library.stats,
    statistics: library.statistics,
    continueWatching: library.continueWatching,
    nowPlaying: library.nowPlaying,
    upcoming: library.upcoming,
  },
  mediaRequests: {
    getOptions: mediaRequests.getOptions,
    listUserDefaults: mediaRequests.listUserDefaultsHandler,
    getMyDefaults: mediaRequests.getMyDefaults,
    setUserDefaults: mediaRequests.setUserDefaultsHandler,
    requestMovie: mediaRequests.requestMovie,
    requestSeries: mediaRequests.requestSeries,
    listUnresolvedSeriesRequests: mediaRequests.listUnresolvedSeriesRequests,
    listRequested: mediaRequests.listRequested,
  },
  playbackDevices: {
    listAvailable: playbackDevices.listAvailable,
    listFavorites: playbackDevices.listFavorites,
    setFavorites: playbackDevices.setFavorites,
    dismiss: playbackDevices.dismiss,
    playOn: playbackDevices.playOn,
  },
  discover: {
    trending: discover.trending,
    popular: discover.popular,
    topMoviesOfYear: discover.topMoviesOfYear,
    upcomingMovies: discover.upcomingMovies,
    upcomingSeries: discover.upcomingSeries,
    search: discover.search,
    browse: discover.browse,
    genres: discover.genres,
    platforms: discover.platforms,
    recommendations: discover.recommendations,
    untrackedEmbyLibrary: discover.untrackedEmbyLibrary,
    requestedNotAvailable: discover.requestedNotAvailable,
  },
  people: {
    get: people.get,
  },
  playbackReporting: {
    activity: playbackReporting.activity,
    users: playbackReporting.users,
  },
  notifications: {
    subscribe: notifications.subscribe,
    unsubscribe: notifications.unsubscribe,
  },
  account: {
    updateName: account.updateName,
    uploadAvatar: account.uploadAvatar,
    removeAvatar: account.removeAvatar,
    platforms: account.platforms,
    updatePlatforms: account.updatePlatformsHandler,
    integrations: {
      list: account.integrationsList,
      create: account.integrationsCreate,
      delete: account.integrationsDelete,
      regenerateToken: account.integrationsRegenerateToken,
      updateEmbyUsername: account.integrationsUpdateEmbyUsername,
      listEmbyLibraries: account.integrationsListEmbyLibraries,
      updateEmbyLibraries: account.integrationsUpdateEmbyLibraries,
    },
  },
  system: {
    publicInfo: system.publicInfo,
    status: system.status,
  },
  admin: {
    settings: {
      get: admin.settingsGet,
      update: admin.settingsUpdate,
    },
    backups: {
      list: admin.backupsList,
      create: admin.backupsCreate,
      delete: admin.backupsDelete,
      restore: admin.backupsRestore,
      schedule: admin.backupsSchedule,
      updateSchedule: admin.backupsUpdateSchedule,
    },
    triggerJob: admin.triggerJob,
    purgeMetadataCache: admin.purgeMetadataCache,
    purgeImageCache: admin.purgeImageCache,
    systemHealth: admin.systemHealth,
  },
  imports: {
    parseFile: imports.parseFile,
    parsePayload: imports.parsePayload,
    createJob: imports.createJob,
    getJob: imports.getJob,
    cancelJob: imports.cancelJob,
    jobEvents: imports.jobEvents,
  },
};

export const router = os.router(implementedRouter);

export type Router = typeof router;
